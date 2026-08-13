import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { v4 as uuid } from 'uuid';
import sharp from 'sharp';
import { ImageOptimizer } from '../common/utils/image-optimizer';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { QueueMonitorService } from '../queue/queue.service';

// A submission moves through UPLOADED -> QUEUED -> PROCESSING -> COMPLETED
// (or FAILED at any point after UPLOADED). submitPhoto() creates the row as
// UPLOADED then immediately enqueues it (-> QUEUED); ProcessingWorker (see
// src/processing/processing.worker.ts) owns every transition after that.
@Injectable()
export class SubmissionsService {
  private logger = new Logger(SubmissionsService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private config: ConfigService,
    private websocketGateway: WebsocketGateway,
    private queueService: QueueMonitorService,
  ) {}

  // ─── BOOTH SESSION ───

  // A "session" here is just a fresh UUID handed back to the kiosk — there's
  // no BoothSession table. It exists purely so the booth can correlate
  // multiple photos/actions from one physical visit via submission.sessionId;
  // the real gatekeeping (campaign active, under submission limit) happens
  // here and again in submitPhoto, since a session isn't required to submit.
  async createSession(campaignSlug: string, hallId?: string) {
    // Verify campaign exists and is active
    const campaign = await this.prisma.campaign.findUnique({ where: { slug: campaignSlug } });

    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    if (campaign.status !== 'ACTIVE') {
      throw new BadRequestException('Campaign is not active');
    }

    // Check max submissions limit
    if (campaign.maxSubmissions) {
      const count = await this.prisma.submission.count({ where: { campaignId: campaign.id } });
      if (count >= campaign.maxSubmissions) {
        throw new BadRequestException('Campaign has reached maximum submissions');
      }
    }

    // Generate a session ID (used to track this booth visit)
    const sessionId = uuid();

    return {
      sessionId,
      campaignId: campaign.id,
      campaignSlug: campaign.slug,
      hallId: hallId || null,
    };
  }

  // ─── PHOTO SUBMISSION ───

  async submitPhoto(
    campaignSlug: string,
    file: Express.Multer.File,
    dto: CreateSubmissionDto,
  ) {
    // 1. Validate campaign
    const campaign = await this.prisma.campaign.findUnique({ where: { slug: campaignSlug } });

    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== 'ACTIVE') throw new BadRequestException('Campaign is not active');

    // 2. Validate required collect fields
    const collectFields = (campaign.collectFields as string[]) || [];
    if (collectFields.includes('name') && !dto.userName) {
      throw new BadRequestException('Name is required for this campaign');
    }
    if (collectFields.includes('phone') && !dto.userPhone) {
      throw new BadRequestException('Phone is required for this campaign');
    }
    if (collectFields.includes('email') && !dto.userEmail) {
      throw new BadRequestException('Email is required for this campaign');
    }

    // 3. Validate file
    if (!file) throw new BadRequestException('Photo is required');

    const allowedTypes = (this.config.get<string>('ALLOWED_MIME_TYPES') || 'image/jpeg,image/png,image/webp').split(',');
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Allowed: ' + allowedTypes.join(', '));
    }

    // The Content-Type header above is client-supplied and trivially spoofed
    // (rename a .txt to .jpg) — this actually decodes the file to confirm
    // its real format, the same check AssetsService uses for backgrounds/
    // frames/props.
    const contentValidation = await ImageOptimizer.validateImage(file.buffer);
    if (!contentValidation.valid) {
      throw new BadRequestException('Uploaded file is not a valid image');
    }

    // 4. Detect orientation — the uploaded photo is stored and used exactly
    // as submitted, no resize or re-encode. It used to be JPEG/PNG
    // re-compressed at quality 90 (and downscaled if larger than the
    // campaign's output dimensions) here, which lost quality on every single
    // submission before the AI provider or the person ever saw it.
    const photoSettings = (campaign.photoSettings as any) || {};
    const optimizedBuffer: Buffer = file.buffer;
    // Auto-detected below from actual image dimensions when neither the
    // booth nor the campaign specified one — previously computed here and
    // then never read, so every submission silently fell back to 'portrait'
    // regardless of the photo's real orientation.
    let orientation: string;

    try {
      const metadata = await sharp(file.buffer).metadata();
      orientation = dto.orientation || photoSettings.orientation ||
        (metadata.width > metadata.height ? 'landscape' : 'portrait');
    } catch (err) {
      this.logger.warn('Orientation detection failed, defaulting: ' + err.message);
      orientation = dto.orientation || photoSettings.orientation || 'portrait';
    }

    // 5. Upload original photo
    let originalUrl: string;
    const useS3 = this.storage.isConfigured();

    if (useS3) {
      originalUrl = await this.storage.upload(
        optimizedBuffer,
        this.storage.getCampaignPath(campaign.slug, 'originals'),
        file.originalname,
        file.mimetype,
      );
    } else {
      // Local fallback. Note the stored value is a bare relative path
      // ("campaigns/.../originals/x.jpg", no leading "/uploads/") — different
      // from AssetsService's convention of storing the full "/uploads/..."
      // URL. deleteSubmission() below and any future reader of originalUrl
      // must remember to join it with the uploads root themselves.
      const fs = await import('fs/promises');
      const path = await import('path');
      const uploadDir = path.join(process.cwd(), 'uploads', 'campaigns', campaign.slug, 'originals');
      await fs.mkdir(uploadDir, { recursive: true });
      const filename = `${uuid()}${path.extname(file.originalname) || '.jpg'}`;
      const filepath = path.join(uploadDir, filename);
      await fs.writeFile(filepath, optimizedBuffer);
      originalUrl = `campaigns/${campaign.slug}/originals/${filename}`;
    }

    // 6. Determine processing mode
    const mode = campaign.processingMode || 'non-ai';

    // 7. Create submission record
    const submission = await this.prisma.submission.create({
      data: {
        campaignId: campaign.id,
        userName: dto.userName || null,
        userEmail: dto.userEmail || null,
        userPhone: dto.userPhone || null,
        sessionId: dto.sessionId || uuid(),
        originalUrl,
        status: 'UPLOADED',
        mode,
        backgroundUsed: dto.backgroundId || null,
        frameUsed: dto.frameId || null,
        templateUsed: dto.templateId || null,
        propsUsed: dto.propIds || [],
        orientation,
        styleUsed: dto.styleUsed || null,
      },
    });

    this.logger.log(`Submission created: ${submission.id} for campaign ${campaign.slug}`);

    // 8. Enqueue for processing
    await this.queueService.addJob(submission.id);
    await this.prisma.submission.update({ where: { id: submission.id }, data: { status: 'QUEUED' } });

    // 9. Notify admin dashboards in real time
    this.websocketGateway.notifyNewSubmission({
      submissionId: submission.id,
      campaignSlug: campaign.slug,
      userName: dto.userName,
      mode,
    });
    this.websocketGateway.notifyQueueStats(await this.queueService.getQueueStats());

    // 10. Return submission ID — the booth will poll for status
    return {
      submissionId: submission.id,
      status: 'QUEUED',
      message: 'Photo uploaded successfully. Processing will begin shortly.',
    };
  }

  // ─── STATUS POLLING ───

  // The booth polls this repeatedly after submitPhoto() until status is
  // COMPLETED or FAILED. Response shape depends on status: COMPLETED adds
  // result/qr/thumbnail URLs (presigned if on S3), FAILED adds an error
  // message, QUEUED/PROCESSING add a rough queue position + wait estimate.
  async getStatus(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        status: true,
        resultUrl: true,
        qrCodeUrl: true,
        thumbnailUrl: true,
        downloadCode: true,
        errorMessage: true,
        processingTime: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!submission) throw new NotFoundException('Submission not found');

    const response: any = {
      submissionId: submission.id,
      status: submission.status,
      createdAt: submission.createdAt,
    };

    if (submission.status === 'COMPLETED') {
      // Generate download URL
      const useS3 = this.storage.isConfigured();
      if (useS3 && submission.resultUrl) {
        response.resultUrl = await this.storage.getPresignedUrl(submission.resultUrl);
        if (submission.qrCodeUrl) {
          response.qrCodeUrl = await this.storage.getPresignedUrl(submission.qrCodeUrl);
        }
        if (submission.thumbnailUrl) {
          response.thumbnailUrl = await this.storage.getPresignedUrl(submission.thumbnailUrl);
        }
      } else {
        response.resultUrl = submission.resultUrl ? `/uploads/${submission.resultUrl}` : null;
        response.qrCodeUrl = submission.qrCodeUrl ? `/uploads/${submission.qrCodeUrl}` : null;
        response.thumbnailUrl = submission.thumbnailUrl ? `/uploads/${submission.thumbnailUrl}` : null;
      }
      response.processingTime = submission.processingTime;

      if (submission.downloadCode) {
        // See the matching comment in DeliveryService.generateQRCode — ADMIN_URL
        // is the app that actually serves /dl/[code]; FRONTEND_URL isn't.
        const baseUrl = this.config.get<string>('ADMIN_URL') || 'http://localhost:3002';
        response.downloadUrl = `${baseUrl}/dl/${submission.downloadCode}`;
        response.downloadCode = submission.downloadCode;
      }
    }

    if (submission.status === 'FAILED') {
      response.error = submission.errorMessage || 'Processing failed';
    }

    if (submission.status === 'QUEUED' || submission.status === 'PROCESSING') {
      // Queue position/wait time is a global estimate across all campaigns
      // (not scoped to this submission's campaign), on the assumption that
      // one shared worker pool processes everything. 25s/job is a rough
      // placeholder, not measured.
      // Get queue position
      const position = await this.prisma.submission.count({
        where: {
          status: { in: ['UPLOADED', 'QUEUED'] },
          createdAt: { lt: submission.createdAt },
        },
      });
      response.queuePosition = position + 1;

      const processing = await this.prisma.submission.count({
        where: { status: 'PROCESSING' },
      });
      response.estimatedWaitSeconds = (position + processing) * 25;
    }

    return response;
  }

  // ─── ADMIN: LIST SUBMISSIONS ───

  async findAll(filters?: { campaignId?: string; status?: string; limit?: number; offset?: number }) {
    const where: any = {};
    if (filters?.campaignId) where.campaignId = filters.campaignId;
    if (filters?.status) where.status = filters.status;

    const [submissions, total] = await Promise.all([
      this.prisma.submission.findMany({
        where,
        include: {
          campaign: { select: { name: true, slug: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: filters?.limit || 50,
        skip: filters?.offset || 0,
      }),
      this.prisma.submission.count({ where }),
    ]);

    return { submissions, total, limit: filters?.limit || 50, offset: filters?.offset || 0 };
  }

  // ─── ADMIN: GET SINGLE SUBMISSION ───

  async findById(id: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      include: {
        campaign: { select: { name: true, slug: true } },
      },
    });

    if (!submission) throw new NotFoundException('Submission not found');
    return submission;
  }

  // ─── ADMIN: RETRY FAILED SUBMISSION ───

  // Re-enqueues the job (the completed/failed BullMQ job for this id was
  // already pruned by removeOnFail, so the same submissionId is free to
  // reuse as the new job's id) and bumps retryCount for visibility. Only
  // valid from FAILED — there's nothing to retry for a submission that's
  // still in flight or already succeeded.
  async retrySubmission(id: string) {
    const submission = await this.prisma.submission.findUnique({ where: { id } });
    if (!submission) throw new NotFoundException('Submission not found');
    if (submission.status !== 'FAILED') {
      throw new BadRequestException('Can only retry failed submissions');
    }

    await this.queueService.addJob(id);
    await this.prisma.submission.update({
      where: { id },
      data: {
        status: 'QUEUED',
        errorMessage: null,
        retryCount: { increment: 1 },
      },
    });
    this.websocketGateway.notifyQueueStats(await this.queueService.getQueueStats());

    return { message: 'Submission queued for retry', submissionId: id };
  }

  // ─── ADMIN: DELETE SUBMISSION ───

  async deleteSubmission(id: string) {
    const submission = await this.prisma.submission.findUnique({ where: { id } });
    if (!submission) throw new NotFoundException('Submission not found');

    // Delete files
    const filesToDelete = [submission.originalUrl, submission.resultUrl, submission.qrCodeUrl, submission.thumbnailUrl].filter(Boolean);

    const useS3 = this.storage.isConfigured();
    if (useS3) {
      await this.storage.deleteMany(filesToDelete);
    } else {
      const fs = await import('fs/promises');
      const path = await import('path');
      for (const file of filesToDelete) {
        try {
          await fs.unlink(path.join(process.cwd(), 'uploads', file));
        } catch {
          // Best-effort cleanup — the file may already be gone; that's fine.
        }
      }
    }

    await this.prisma.submission.delete({ where: { id } });
    return { message: 'Submission deleted' };
  }
}


