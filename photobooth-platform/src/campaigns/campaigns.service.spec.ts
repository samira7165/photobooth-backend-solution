import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { PrismaService } from '../prisma/prisma.service';
import { DeveloperKeysService } from '../developer-keys/developer-keys.service';
import { CorsService } from '../common/services/cors.service';

describe('CampaignsService', () => {
  let service: CampaignsService;

  const mockPrisma = {
    campaign: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  // create() auto-provisions a developer API key for every new campaign
  // (see CampaignsService.create) — mocked here so create() tests don't
  // need a real DeveloperKeysService/database.
  const mockDeveloperKeysService = {
    generateKey: jest.fn().mockResolvedValue({ key: 'pb_live_mock', keyPrefix: 'pb_live_mock' }),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('http://localhost:3000/api/v1/public'),
  };

  // create()/update() clear CorsService's cache after an allowedOrigins
  // change — mocked here so tests don't need a real CorsService/database.
  const mockCorsService = {
    clearCache: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDeveloperKeysService.generateKey.mockResolvedValue({ key: 'pb_live_mock', keyPrefix: 'pb_live_mock' });
    mockConfigService.get.mockReturnValue('http://localhost:3000/api/v1/public');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampaignsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DeveloperKeysService, useValue: mockDeveloperKeysService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: CorsService, useValue: mockCorsService },
      ],
    }).compile();

    service = module.get<CampaignsService>(CampaignsService);
  });

  describe('create — slug uniqueness', () => {
    it('rejects a slug that already exists', async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({ id: 'existing', slug: 'taken-slug' });

      await expect(
        service.create({ name: 'New Campaign', slug: 'taken-slug' } as any, 'user1'),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.campaign.create).not.toHaveBeenCalled();
    });

    it('rejects a slug with invalid characters', async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ name: 'New Campaign', slug: 'Not A Valid Slug!' } as any, 'user1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.campaign.create).not.toHaveBeenCalled();
    });

    it('creates the campaign when the slug is free and valid, and writes an audit log', async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue(null);
      mockPrisma.campaign.create.mockResolvedValue({ id: 'new-1', name: 'New Campaign', slug: 'new-campaign' });

      const result = await service.create({ name: 'New Campaign', slug: 'new-campaign' } as any, 'user1');

      expect(result.id).toBe('new-1');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'campaign.created', userId: 'user1' }),
        }),
      );
    });

    it('auto-provisions a developer API key and returns an integrationConfig with the one-time plaintext key', async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue(null);
      mockPrisma.campaign.create.mockResolvedValue({
        id: 'new-1',
        name: 'New Campaign',
        slug: 'new-campaign',
        processingMode: 'non-ai',
        collectFields: ['name', 'phone'],
        outputMode: 'qr',
      });

      const result = await service.create({ name: 'New Campaign', slug: 'new-campaign' } as any, 'user1');

      expect(mockDeveloperKeysService.generateKey).toHaveBeenCalledWith(
        'new-1',
        'Default Integration Key',
        { mode: 'live' },
      );
      expect(result.integrationConfig).toEqual(
        expect.objectContaining({
          campaignSlug: 'new-campaign',
          apiKey: 'pb_live_mock',
          keyPrefix: 'pb_live_mock',
          authHeader: 'x-api-key',
        }),
      );
    });
  });

  describe('update — slug uniqueness on rename', () => {
    it('rejects renaming to a slug already used by a different campaign', async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({ id: '1', status: 'DRAFT' }); // findById() inside update()
      mockPrisma.campaign.findFirst.mockResolvedValue({ id: '2', slug: 'someone-elses-slug' });

      await expect(
        service.update('1', { slug: 'someone-elses-slug' } as any, 'user1'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a status field on the generic update — must go through updateStatus()', async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({ id: '1', status: 'DRAFT' });

      await expect(
        service.update('1', { status: 'ACTIVE' } as any, 'user1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateStatus — transition validation', () => {
    it('throws NotFoundException for a campaign that does not exist', async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue(null);
      await expect(service.updateStatus('missing', 'ACTIVE', 'user1')).rejects.toThrow(NotFoundException);
    });

    it('rejects an invalid transition (DRAFT -> COMPLETED)', async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({ id: '1', status: 'DRAFT' });
      await expect(service.updateStatus('1', 'COMPLETED', 'user1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.campaign.update).not.toHaveBeenCalled();
    });

    it('rejects a transition out of a terminal state (ARCHIVED -> anything)', async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({ id: '1', status: 'ARCHIVED' });
      await expect(service.updateStatus('1', 'ACTIVE', 'user1')).rejects.toThrow(BadRequestException);
    });

    it('allows the valid transition DRAFT -> ACTIVE', async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({ id: '1', status: 'DRAFT' });
      mockPrisma.campaign.update.mockResolvedValue({ id: '1', status: 'ACTIVE' });

      const result = await service.updateStatus('1', 'ACTIVE', 'user1');

      expect(result.status).toBe('ACTIVE');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'campaign.status_changed', metadata: { from: 'DRAFT', to: 'ACTIVE' } }),
        }),
      );
    });

    it.each([
      ['ACTIVE', 'PAUSED'],
      ['ACTIVE', 'COMPLETED'],
      ['PAUSED', 'ACTIVE'],
      ['PAUSED', 'COMPLETED'],
      ['COMPLETED', 'ARCHIVED'],
    ])('allows the valid transition %s -> %s', async (from, to) => {
      mockPrisma.campaign.findUnique.mockResolvedValue({ id: '1', status: from });
      mockPrisma.campaign.update.mockResolvedValue({ id: '1', status: to });

      const result = await service.updateStatus('1', to, 'user1');
      expect(result.status).toBe(to);
    });
  });

  describe('delete', () => {
    it('refuses to delete an ACTIVE campaign', async () => {
      mockPrisma.campaign.findUnique.mockResolvedValue({ id: '1', status: 'ACTIVE' });
      await expect(service.delete('1', 'user1')).rejects.toThrow(BadRequestException);
    });
  });
});
