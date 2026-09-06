import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { SubmissionsService } from './submissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { QueueMonitorService } from '../queue/queue.service';
import { DeliveryService } from '../delivery/delivery.service';

// Focused on print() — the rest of SubmissionsService (submitPhoto, getStatus,
// etc.) already has live coverage via test/booth-flow.e2e-spec.ts.
describe('SubmissionsService — print()', () => {
  let service: SubmissionsService;

  const mockPrisma = {
    submission: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockStorage = { isConfigured: jest.fn().mockReturnValue(false) };
  const mockConfig = { get: jest.fn() };
  const mockWebsocketGateway = { notifyNewSubmission: jest.fn(), notifyQueueStats: jest.fn() };
  const mockQueueService = { addJob: jest.fn(), getQueueStats: jest.fn() };
  const mockDeliveryService = { resolveDeliveryConfig: jest.fn().mockReturnValue({ qrCode: {}, shortCode: {}, directLink: {}, print: {} }) };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDeliveryService.resolveDeliveryConfig.mockReturnValue({ qrCode: {}, shortCode: {}, directLink: {}, print: {} });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubmissionsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: ConfigService, useValue: mockConfig },
        { provide: WebsocketGateway, useValue: mockWebsocketGateway },
        { provide: QueueMonitorService, useValue: mockQueueService },
        { provide: DeliveryService, useValue: mockDeliveryService },
      ],
    }).compile();

    service = module.get<SubmissionsService>(SubmissionsService);
  });

  // Requirement 1: first print succeeds.
  it('claims and marks a COMPLETED submission as printed on the first request', async () => {
    mockPrisma.submission.updateMany.mockResolvedValue({ count: 1 }); // won the claim
    mockPrisma.submission.findUnique.mockResolvedValue({ status: 'COMPLETED', resultUrl: 'campaigns/x/outputs/1.png' });
    mockPrisma.submission.update.mockResolvedValue({ printedAt: new Date('2026-01-01T00:00:00Z') });

    const result = await service.print('sub-1', 'kiosk-a');

    expect(mockPrisma.submission.updateMany).toHaveBeenCalledWith({
      where: { id: 'sub-1', printStatus: { in: ['NOT_PRINTED', 'FAILED'] } },
      data: { printStatus: 'PRINT_REQUESTED', printerId: 'kiosk-a', printAttempts: { increment: 1 }, printError: null },
    });
    expect(mockPrisma.submission.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { printStatus: 'PRINTED', printedAt: expect.any(Date) },
      select: { printedAt: true },
    });
    expect(result).toEqual({
      success: true,
      alreadyPrinted: false,
      message: 'Print recorded successfully.',
      printedAt: expect.any(Date),
    });
  });

  // Requirement 2: second print of the same image returns alreadyPrinted.
  it('reports alreadyPrinted without touching printedAt again when the submission is already PRINTED', async () => {
    mockPrisma.submission.updateMany.mockResolvedValue({ count: 0 }); // lost the claim — not NOT_PRINTED/FAILED anymore
    mockPrisma.submission.findUnique.mockResolvedValue({
      printStatus: 'PRINTED',
      printedAt: new Date('2026-01-01T00:00:00Z'),
    });

    const result = await service.print('sub-1');

    expect(result).toEqual({
      success: false,
      alreadyPrinted: true,
      message: 'This image has already been printed.',
      printedAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(mockPrisma.submission.update).not.toHaveBeenCalled();
  });

  // A concurrent claim mid-flight (PRINT_REQUESTED/PRINTING) reads as
  // "don't print it again" from this caller's point of view too.
  it('reports alreadyPrinted when a concurrent request is still mid-claim (PRINT_REQUESTED)', async () => {
    mockPrisma.submission.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.submission.findUnique.mockResolvedValue({ printStatus: 'PRINT_REQUESTED', printedAt: null });

    const result = await service.print('sub-1');

    expect(result.success).toBe(false);
    expect(result.alreadyPrinted).toBe(true);
    expect(result.message).toMatch(/already being printed/i);
  });

  // Requirement 3: a failed print does not mark the image as printed.
  it('finalizes to FAILED (not PRINTED) and throws when the claimed submission has no completed result', async () => {
    mockPrisma.submission.updateMany.mockResolvedValue({ count: 1 }); // won the claim
    mockPrisma.submission.findUnique.mockResolvedValue({ status: 'PROCESSING', resultUrl: null });

    await expect(service.print('sub-1')).rejects.toThrow(BadRequestException);

    expect(mockPrisma.submission.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { printStatus: 'FAILED', printError: 'No completed result available to print' },
    });
    // Never the success path.
    expect(mockPrisma.submission.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ printStatus: 'PRINTED' }) }),
    );
  });

  // Requirement 4: a retry after a failed print can succeed — the claim
  // query itself must allow FAILED as a claimable starting state.
  it('allows re-claiming from FAILED (the updateMany WHERE includes FAILED as claimable)', async () => {
    mockPrisma.submission.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.submission.findUnique.mockResolvedValue({ status: 'COMPLETED', resultUrl: 'x.png' });
    mockPrisma.submission.update.mockResolvedValue({ printedAt: new Date() });

    await service.print('sub-1');

    expect(mockPrisma.submission.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ printStatus: { in: ['NOT_PRINTED', 'FAILED'] } }) }),
    );
  });

  // Requirement 7: nonexistent images are rejected.
  it('throws NotFoundException for a submission that does not exist', async () => {
    mockPrisma.submission.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.submission.findUnique.mockResolvedValue(null);

    await expect(service.print('does-not-exist')).rejects.toThrow(NotFoundException);
  });
});
