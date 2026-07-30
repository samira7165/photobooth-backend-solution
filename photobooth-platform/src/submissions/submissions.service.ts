import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { v4 as uuid } from 'uuid';
import sharp from 'sharp';

// A submission moves through UPLOADED -> QUEUED -> PROCESSING -> COMPLETED
// (or FAILED at any point after UPLOADED). This service only ever creates
// submissions as UPLOADED — the later transitions belong to the processing
// pipeline (queue/worker), which isn't built yet, so QUEUED/PROCESSING/
// COMPLETED are handled here defensively (see getStatus) but not currently
// reachable through any implemented flow.
@Injectable()
export class SubmissionsService {
  private logger = new Logger(SubmissionsService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private config: ConfigService,
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

    // 4. Optimize the image before storing
    const photoSettings = (campaign.photoSettings as any) || {};
    let optimizedBuffer = file.buffer;

    try {
      let sharpInstance = sharp(file.buffer);
      const metadata = await sharpInstance.metadata();

      // Auto-detect orientation if not specified
      const orientation = dto.orientation || photoSettings.orientation ||
        (metadata.width > metadata.height ? 'landscape' : 'portrait');

      // Resize if larger than max dimensions (preserve aspect ratio)
      const maxWidth = photoSettings.outputWidth || 1920;
      const maxHeight = photoSettings.outputHeight || 1080;

      if (metadata.width > maxWidth || metadata.height > maxHeight) {
        sharpInstance = sharp(file.buffer).resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      // Convert to JPEG for consistency (unless PNG transparency is needed)
      if (file.mimetype !== 'image/png') {
        optimizedBuffer = await sharpInstance.jpeg({ quality: 90 }).toBuffer();
      } else {
        optimizedBuffer = await sharpInstance.png({ quality: 90 }).toBuffer();
      }
    } catch (err) {
      this.logger.warn('Image optimization failed, using original: ' + err.message);
      optimizedBuffer = file.buffer;
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
        propsUsed: dto.propIds || [],
        orientation: dto.orientation || 'portrait',
        styleUsed: dto.styleUsed || null,
      },
    });

    this.logger.log(`Submission created: ${submission.id} for campaign ${campaign.slug}`);

    // 8. Return submission ID — the booth will poll for status
    return {
      submissionId: submission.id,
      status: submission.status,
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

  // Resets status back to UPLOADED so the (future) processing worker picks
  // it up again, and bumps retryCount for visibility. Only valid from FAILED
  // — there's nothing to retry for a submission that's still in flight or
  // already succeeded.
  async retrySubmission(id: string) {
    const submission = await this.prisma.submission.findUnique({ where: { id } });
    if (!submission) throw new NotFoundException('Submission not found');
    if (submission.status !== 'FAILED') {
      throw new BadRequestException('Can only retry failed submissions');
    }

    await this.prisma.submission.update({
      where: { id },
      data: {
        status: 'UPLOADED',
        errorMessage: null,
        retryCount: { increment: 1 },
      },
    });

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
        } catch {}
      }
    }

    await this.prisma.submission.delete({ where: { id } });
    return { message: 'Submission deleted' };
  }
}
