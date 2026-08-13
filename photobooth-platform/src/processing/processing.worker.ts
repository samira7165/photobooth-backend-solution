import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ImageService } from '../image/image.service';
import { BackgroundRemoverService } from '../image/background-remover.service';
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
    private backgroundRemoverService: BackgroundRemoverService,
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

    console.log('\n========== CAMPAIGN AI CONFIG ==========');
    console.log(JSON.stringify(campaign.aiConfig, null, 2));
    console.log('=========================================\n');

    await this.prisma.submission.update({ where: { id: submissionId }, data: { status: 'PROCESSING' } });
    this.websocketGateway.notifyJobStatusUpdate(submissionId, campaign.slug, { status: 'PROCESSING', progress: 10 });
    await job.updateProgress(10);

    const originalBuffer = await this.loadOriginal(submission.originalUrl);
    await job.updateProgress(30);

    const photoSettings = (campaign.photoSettings as any) || {};
    let resultBuffer: Buffer;
    let mimeType: string;
    let aiMeta: { provider: string; model: string; keyId: string; prompt?: string; tokensUsed?: number; costEstimate?: number; referenceImageUrl?: string } | undefined;

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
        backgroundConfig: campaign.backgroundConfig,
        textConfig: campaign.textConfig,
      });
      resultBuffer = processed.resultBuffer;
      mimeType = processed.mimeType;
    } else {
      const aiConfig = (campaign.aiConfig as any) || {};

      // If a background swap is configured, apply it to the *original* photo
      // before generation — not after. Running background removal on an
      // already AI-transformed image (arbitrary generated background, no
      // clean subject/background split left to segment) wouldn't work. This
      // way "change the background" behaves the same — and uses the same
      // code — for both modes: the swap happens once, upstream of whatever
      // mode-specific work follows.
      let generationInput = originalBuffer;
      if (campaign.backgroundConfig && (campaign.backgroundConfig as any).removal && submission.backgroundUsed) {
        try {
          const isolated = await this.backgroundRemoverService.removeBackground(originalBuffer);
          generationInput = await this.imageService.compositeOnBackground(
            isolated,
            submission.backgroundUsed,
            photoSettings.outputWidth || 1080,
            photoSettings.outputHeight || 1920,
          );
        } catch (err: any) {
          this.logger.warn(`Background swap before AI generation failed, using original photo: ${err.message}`);
          generationInput = originalBuffer;
        }
      }

      // A Template is the booth user's chosen reference style (e.g. which
      // Spider-Man suit) — its image goes to the AI provider as a second,
      // style-reference image, and its own prompt (if set) overrides the
      // campaign's default for just this submission.
      let referenceImageBuffer: Buffer | undefined;
      let template: { id: string; name: string; imageUrl: string; prompt: string | null } | null = null;
      if (submission.templateUsed) {
        template = await this.prisma.template.findUnique({
          where: { id: submission.templateUsed },
          select: { id: true, name: true, imageUrl: true, prompt: true },
        });
        if (template) {
          try {
            referenceImageBuffer = await this.imageService.loadAssetImage(template.imageUrl);
            this.logger.log(`Submission ${submissionId} using template "${template.name}" (${template.id}) — reference image loaded from ${template.imageUrl}`);
          } catch (err: any) {
            this.logger.warn(`Failed to load template reference image, continuing without it: ${err.message}`);
          }
        } else {
          this.logger.warn(`Submission ${submissionId} references template ${submission.templateUsed}, but it no longer exists`);
        }
      }
      const effectiveAiConfig = { ...aiConfig, prompt: template?.prompt || aiConfig.prompt };

      // submission.promptUsed is only written to the DB once generation
      // finishes (see aiMeta below and the update() call further down) — the
      // submission loaded at the top of process() is from before that, so it
      // reads NOT SET here every time. Not a bug — logged anyway since it's
      // useful to see that explicitly rather than silently omit it.
      console.log('\n========== PROMPT DEBUG ==========');
      console.log('submission.promptUsed:', submission.promptUsed || 'NOT SET');
      console.log('aiConfig.prompt:', aiConfig?.prompt || 'NOT SET');
      console.log('template.prompt (if any):', template?.prompt || (template as any)?.aiPrompt || 'NOT SET');
      console.log('FINAL prompt being sent:', effectiveAiConfig.prompt);
      console.log('==================================\n');

      // ProcessingService.generate() resolves a key internally (via
      // AiProvidersService.getKeyWithFailover(), or a specific keyChain if
      // the campaign has one configured) — logged here at the worker's own
      // boundary so the full worker -> key selection -> result flow shows up
      // together in the terminal.
      this.logger.log(`Requesting API key for campaign: ${campaign.slug}`);
      const generation = await this.processingService.generate(
        campaign.id,
        generationInput,
        effectiveAiConfig,
        referenceImageBuffer,
        photoSettings.outputWidth || 1080,
        photoSettings.outputHeight || 1920,
      );
      this.logger.log(`Got key: ${generation.keyId} from provider: ${generation.provider}`);

      const postProcessed = await this.imageService.postProcess(generation.resultBuffer, {
        campaignId: campaign.id,
        campaignSlug: campaign.slug,
        submissionId,
        frameId: submission.frameUsed || undefined,
        propIds: (submission.propsUsed as string[]) || undefined,
        orientation: submission.orientation || undefined,
        outputWidth: photoSettings.outputWidth,
        outputHeight: photoSettings.outputHeight,
        textConfig: campaign.textConfig,
        qrConfig: campaign.qrConfig,
      });
      resultBuffer = postProcessed.resultBuffer;
      mimeType = postProcessed.mimeType;

      aiMeta = {
        provider: generation.provider,
        model: generation.model,
        keyId: generation.keyId,
        prompt: effectiveAiConfig.prompt,
        tokensUsed: generation.tokensUsed,
        costEstimate: generation.costEstimate,
        referenceImageUrl: template?.imageUrl,
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
          referenceImageUrl: aiMeta.referenceImageUrl,
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
