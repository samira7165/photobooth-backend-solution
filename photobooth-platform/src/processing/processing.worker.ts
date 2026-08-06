import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ImageService } from '../image/image.service';
import { DeliveryService } from '../delivery/delivery.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { ProcessingService } from './processing.service';
import { PHOTO_PROCESSING_QUEUE } from '../queue/queue.service';

interface ProcessSubmissionJobData {
  submissionId: string;
}

// Consumes jobs QueueMonitorService.addJob() enqueues. Owns every status
// transition after QUEUED: PROCESSING -> COMPLETED or FAILED.
@Processor(PHOTO_PROCESSING_QUEUE)
@Injectable()
export class ProcessingWorker extends WorkerHost {
  private logger = new Logger(ProcessingWorker.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private imageService: ImageService,
    private deliveryService: DeliveryService,
    private websocketGateway: WebsocketGateway,
    private processingService: ProcessingService,
  ) {
    super();
  }

  async process(job: Job<ProcessSubmissionJobData>): Promise<void> {
    const { submissionId } = job.data;
    const startedAt = Date.now();

    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { campaign: true },
    });
    if (!submission) {
      this.logger.warn(`Submission ${submissionId} not found, dropping job`);
      return;
    }

    const { campaign } = submission;
    this.logger.log(`Processing submission ${submissionId} (attempt ${job.attemptsMade + 1})`);

    await this.prisma.submission.update({ where: { id: submissionId }, data: { status: 'PROCESSING' } });
    this.websocketGateway.notifyJobStatusUpdate(submissionId, campaign.slug, { status: 'PROCESSING', progress: 10 });
    await job.updateProgress(10);

    const originalBuffer = await this.loadOriginal(submission.originalUrl);
    await job.updateProgress(30);

    const photoSettings = (campaign.photoSettings as any) || {};
    let resultBuffer: Buffer;
    let mimeType: string;
    let aiMeta: { provider: string; model: string; keyId: string; prompt?: string; tokensUsed?: number; costEstimate?: number } | undefined;

    if (submission.mode === 'non-ai') {
      const processed = await this.imageService.processNonAI(originalBuffer, {
        campaignId: campaign.id,
        campaignSlug: campaign.slug,
        submissionId,
        backgroundId: submission.backgroundUsed || undefined,
        frameId: submission.frameUsed || undefined,
        propIds: (submission.propsUsed as string[]) || undefined,
        orientation: submission.orientation || undefined,
        outputWidth: photoSettings.outputWidth,
        outputHeight: photoSettings.outputHeight,
        brandConfig: campaign.brandConfig,
        backgroundConfig: campaign.backgroundConfig,
        textConfig: campaign.textConfig,
      });
      resultBuffer = processed.resultBuffer;
      mimeType = processed.mimeType;
    } else {
      const aiConfig = (campaign.aiConfig as any) || {};
      const generation = await this.processingService.generate(campaign.id, originalBuffer, aiConfig);

      const postProcessed = await this.imageService.postProcess(generation.resultBuffer, {
        campaignId: campaign.id,
        campaignSlug: campaign.slug,
        submissionId,
        frameId: submission.frameUsed || undefined,
        propIds: (submission.propsUsed as string[]) || undefined,
        orientation: submission.orientation || undefined,
        outputWidth: photoSettings.outputWidth,
        outputHeight: photoSettings.outputHeight,
        brandConfig: campaign.brandConfig,
        textConfig: campaign.textConfig,
        qrConfig: campaign.qrConfig,
      });
      resultBuffer = postProcessed.resultBuffer;
      mimeType = postProcessed.mimeType;

      aiMeta = {
        provider: generation.provider,
        model: generation.model,
        keyId: generation.keyId,
        prompt: aiConfig.prompt,
        tokensUsed: generation.tokensUsed,
        costEstimate: generation.costEstimate,
      };
    }

    this.websocketGateway.notifyJobStatusUpdate(submissionId, campaign.slug, { status: 'PROCESSING', progress: 60 });
    await job.updateProgress(60);

    let resultUrl = await this.saveOutput(resultBuffer, campaign.slug, 'outputs', `${submissionId}.png`, mimeType);
    this.websocketGateway.notifyJobStatusUpdate(submissionId, campaign.slug, { status: 'PROCESSING', progress: 75 });
    await job.updateProgress(75);

    const thumbBuffer = await this.imageService.generateThumbnail(resultBuffer, 300);
    const thumbnailUrl = await this.saveOutput(thumbBuffer, campaign.slug, 'thumbnails', `${submissionId}-thumb.jpg`, 'image/jpeg');
    this.websocketGateway.notifyJobStatusUpdate(submissionId, campaign.slug, { status: 'PROCESSING', progress: 85 });
    await job.updateProgress(85);

    const qrConfig = campaign.qrConfig as any;
    const qrResult = await this.deliveryService.generateQRCode(submissionId, campaign.slug, qrConfig);
    if (qrResult.qrCodeUrl && qrConfig?.embedInImage) {
      const qrBuffer = await this.loadOutput(qrResult.qrCodeUrl);
      const embedded = await this.deliveryService.embedQRInImage(
        resultBuffer,
        qrBuffer,
        qrConfig,
        photoSettings.outputWidth || 1080,
        photoSettings.outputHeight || 1920,
      );
      resultUrl = await this.saveOutput(embedded, campaign.slug, 'outputs', `${submissionId}-final.png`, 'image/png');
    }
    this.websocketGateway.notifyJobStatusUpdate(submissionId, campaign.slug, { status: 'PROCESSING', progress: 95 });
    await job.updateProgress(95);

    const processingTime = Date.now() - startedAt;
    await this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        status: 'COMPLETED',
        resultUrl,
        thumbnailUrl,
        processingTime,
        ...(aiMeta && {
          aiProvider: aiMeta.provider,
          aiModel: aiMeta.model,
          apiKeyUsed: aiMeta.keyId,
          promptUsed: aiMeta.prompt,
          tokensUsed: aiMeta.tokensUsed,
          costEstimate: aiMeta.costEstimate,
        }),
      },
    });

    this.websocketGateway.notifyJobStatusUpdate(submissionId, campaign.slug, {
      status: 'COMPLETED',
      progress: 100,
      resultUrl: resultUrl.startsWith('http') ? resultUrl : `/uploads/${resultUrl}`,
      qrCodeUrl: qrResult.qrCodeUrl ? (qrResult.qrCodeUrl.startsWith('http') ? qrResult.qrCodeUrl : `/uploads/${qrResult.qrCodeUrl}`) : undefined,
      downloadUrl: qrResult.downloadUrl || undefined,
      downloadCode: qrResult.downloadUrl ? qrResult.downloadUrl.split('/').pop() : undefined,
      processingTime,
    });
    await job.updateProgress(100);

    this.logger.log(`Submission ${submissionId} completed in ${processingTime}ms`);
  }

  // Fires on every failed attempt, not just the last one — only persist
  // FAILED to the DB once BullMQ has exhausted all attempts; earlier
  // failures just log and let BullMQ's own backoff retry the job.
  @OnWorkerEvent('failed')
  async onFailed(job: Job<ProcessSubmissionJobData>, error: Error) {
    const maxAttempts = job.opts.attempts ?? 1;
    this.logger.warn(`Job ${job.id} failed (attempt ${job.attemptsMade}/${maxAttempts}): ${error.message}`);

    if (job.attemptsMade < maxAttempts) {
      return;
    }

    const { submissionId } = job.data;
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { campaign: true },
    });
    if (!submission) return;

    await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status: 'FAILED', errorMessage: error.message },
    });
    this.websocketGateway.notifyJobStatusUpdate(submissionId, submission.campaign.slug, {
      status: 'FAILED',
      error: error.message,
    });
  }

  // Submission originals never get the "/uploads/" prefix asset images do
  // (see SubmissionsService.submitPhoto's comment) — bare relative path in
  // local dev, S3 key when configured.
  private async loadOriginal(originalUrl: string): Promise<Buffer> {
    if (this.storage.isConfigured()) {
      return this.storage.download(originalUrl);
    }
    return fs.readFile(path.join(process.cwd(), 'uploads', originalUrl));
  }

  // Outputs (results/thumbnails/QR codes) follow the same convention as
  // DeliveryService.generateQRCode's own saves.
  private async loadOutput(url: string): Promise<Buffer> {
    if (this.storage.isConfigured()) {
      return this.storage.download(url);
    }
    return fs.readFile(path.join(process.cwd(), 'uploads', url));
  }

  private async saveOutput(buffer: Buffer, campaignSlug: string, subfolder: string, filename: string, contentType: string): Promise<string> {
    if (this.storage.isConfigured()) {
      return this.storage.upload(buffer, this.storage.getCampaignPath(campaignSlug, subfolder), filename, contentType);
    }
    const dir = path.join(process.cwd(), 'uploads', 'campaigns', campaignSlug, subfolder);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), buffer);
    return `campaigns/${campaignSlug}/${subfolder}/${filename}`;
  }
}
