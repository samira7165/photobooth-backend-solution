import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { CreateSubmissionDto } from './dto/create-submission.dto';
import { v4 as uuid } from 'uuid';
import sharp from 'sharp';
import heicConvert from 'heic-convert';
import { ImageOptimizer } from '../common/utils/image-optimizer';
import { sanitizeCustomInput, buildCustomPrompt } from '../common/utils/custom-prompt.util';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { QueueMonitorService } from '../queue/queue.service';
import { DeliveryService } from '../delivery/delivery.service';

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
    private deliveryService: DeliveryService,
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

    // Video-response booths (e.g. Dream Job) send submissionType: 'video'.
    // This skips every AI/photo-specific step below — template/prompt-option
    // selection, HEIC handling, sharp decoding, ImageOptimizer validation,
    // and the processing queue — none of which apply to a video file.
    // dto.submissionType is the primary signal, but a client that uploads a
    // real video Blob without setting it (or sets it inconsistently) would
    // otherwise fall through to the image/AI pipeline undetected — the
    // file's own mimetype/filename is checked too so that can't happen.
    const uploadedMimeType = (file?.mimetype || '').split(';')[0].trim();
    const isVideo =
      dto.submissionType === 'video' ||
      uploadedMimeType.startsWith('video/') ||
      /\.(webm|mp4|mov|mkv)$/i.test(file?.originalname || '');

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

    // 2b. Validate template/prompt-option/custom-input selection. Only
    // applies to AI-mode submissions — non-ai never uses any of them.
    // Matches ProcessingWorker's own `submission.mode === 'non-ai'` branch
    // condition exactly, so "does this submission need one of these" is
    // decided the same way in both places.
    const mode = campaign.processingMode || 'non-ai';
    let promptOption: { id: string; prompt: string } | null = null;
    let customInputRaw: string | null = null;
    let customInputPrompt: string | null = null;
    if (!isVideo && mode !== 'non-ai') {
      const aiConfig = (campaign.aiConfig as any) || {};
      // Unset defaults to 'template' — existing campaigns (created before
      // promptMode existed) keep their current, unenforced templateId
      // behavior exactly as-is. Only campaigns that explicitly opt into
      // 'prompt-option'/'both' get the new required-field validation below.
      const promptMode = aiConfig.promptMode || 'template';
      const customInputConfig = aiConfig.customInput || {};

      if (dto.promptOptionId && dto.customInput) {
        throw new BadRequestException('Provide either promptOptionId or customInput, not both');
      }
      const hasPromptSelection = !!dto.promptOptionId || !!dto.customInput;

      if (promptMode === 'prompt-option' && !hasPromptSelection) {
        throw new BadRequestException('promptOptionId is required for this campaign');
      }
      if (promptMode === 'both' && !hasPromptSelection && !dto.templateId) {
        throw new BadRequestException('Either templateId or promptOptionId is required for this campaign');
      }

      if (dto.promptOptionId) {
        if (promptMode === 'template') {
          throw new BadRequestException('This campaign does not accept promptOptionId');
        }
        const option = await this.prisma.promptOption.findUnique({
          where: { id: dto.promptOptionId },
          select: { id: true, campaignId: true, isActive: true, prompt: true },
        });
        if (!option || option.campaignId !== campaign.id) {
          throw new BadRequestException('Invalid promptOptionId for this campaign');
        }
        if (!option.isActive) {
          throw new BadRequestException('This prompt option is no longer available');
        }
        promptOption = { id: option.id, prompt: option.prompt };
      }

      if (dto.customInput) {
        if (promptMode === 'template') {
          throw new BadRequestException('This campaign does not accept customInput');
        }
        if (!customInputConfig.enabled) {
          throw new BadRequestException('Custom input is not enabled for this campaign');
        }
        const maxLength = customInputConfig.maxLength || 50;
        if (dto.customInput.length > maxLength) {
          throw new BadRequestException(`customInput must be ${maxLength} characters or fewer`);
        }
        const cleaned = sanitizeCustomInput(dto.customInput);
        if (!cleaned) {
          throw new BadRequestException('customInput cannot be empty');
        }
        if (!customInputConfig.promptTemplate) {
          throw new BadRequestException('This campaign has custom input enabled but no prompt template configured');
        }
        customInputRaw = cleaned;
        customInputPrompt = buildCustomPrompt(customInputConfig.promptTemplate, cleaned);
      }

      // Backstop: if neither a prompt option nor custom input resolved a
      // prompt above, this submission is relying on the template/default-
      // prompt path — make sure there's actually a real prompt there too,
      // instead of silently falling through to ProcessingService's
      // hardcoded generic default ('Enhance this photo') the way the
      // "Prothom Alo" campaign did before this check existed (promptMode
      // left at its 'template' default, no template, empty aiConfig.prompt
      // — every submission quietly got a prompt nobody configured).
      // CampaignsService.updateStatus() blocks *activating* an AI campaign
      // in this exact state, but only at that one moment; this catches it
      // on every submission too, including after a later edit breaks an
      // already-ACTIVE campaign. Also validates templateId itself (ownership
      // + isActive), which nothing did before — ProcessingWorker previously
      // just warned and silently continued without a reference image for an
      // invalid one instead of rejecting the submission up front.
      if (!promptOption && !customInputPrompt) {
        let templatePrompt: string | null = null;
        if (dto.templateId) {
          const template = await this.prisma.template.findUnique({
            where: { id: dto.templateId },
            select: { campaignId: true, isActive: true, prompt: true },
          });
          if (!template || template.campaignId !== campaign.id) {
            throw new BadRequestException('Invalid templateId for this campaign');
          }
          if (!template.isActive) {
            throw new BadRequestException('This template is no longer available');
          }
          templatePrompt = template.prompt;
        }
        const hasPrompt = !!(templatePrompt?.trim() || aiConfig.prompt?.trim());
        if (!hasPrompt) {
          throw new BadRequestException(
            'This campaign has no AI prompt configured yet. Please contact the campaign administrator.',
          );
        }
      }
    }

    // 3. Validate file
    if (!file) throw new BadRequestException(isVideo ? 'Video is required' : 'Photo is required');

    let photoBuffer: Buffer;
    let photoMimeType: string;
    let photoFilename: string | undefined = file.originalname;
    let optimizedBuffer: Buffer;
    let orientation: string;

    if (isVideo) {
      // MediaRecorder's blob.type (and therefore this multipart part's
      // Content-Type) is usually codec-qualified — e.g.
      // "video/webm;codecs=vp8,opus" — not the bare "video/webm" a curl test
      // would typically send. Compare only the base type so a real browser
      // recording isn't rejected by an exact-string mismatch; the codec
      // suffix carries no information the size/mimetype checks below need.
      const baseMimeType = (file.mimetype || '').split(';')[0].trim();
      const allowedVideoTypes = (
        this.config.get<string>('ALLOWED_VIDEO_MIME_TYPES') || 'video/webm,video/mp4,video/quicktime,video/x-matroska'
      ).split(',');
      if (!allowedVideoTypes.includes(baseMimeType)) {
        throw new BadRequestException('Invalid video type. Allowed: ' + allowedVideoTypes.join(', '));
      }
      const maxVideoSize = parseInt(this.config.get<string>('MAX_VIDEO_FILE_SIZE') || '', 10) || 104857600;
      if (file.buffer.length > maxVideoSize) {
        throw new BadRequestException(`Video exceeds the ${(maxVideoSize / (1024 * 1024)).toFixed(0)}MB limit`);
      }

      photoBuffer = file.buffer;
      photoMimeType = baseMimeType;
      optimizedBuffer = photoBuffer;
      orientation = dto.orientation || 'portrait';

      this.logger.log(
        `[QUALITY] Video upload received: ${(file.buffer.length / 1024).toFixed(0)}KB, type: ${file.mimetype}`,
      );
    } else {
      // Multer's fileSize limit (submissions.module.ts) is shared with the
      // larger video ceiling above, so a photo upload needs its own check
      // against the image-specific max instead of relying on that shared limit.
      const maxImageSize = parseInt(this.config.get<string>('MAX_FILE_SIZE') || '', 10) || 10485760;
      if (file.buffer.length > maxImageSize) {
        throw new BadRequestException(`Photo exceeds the ${(maxImageSize / (1024 * 1024)).toFixed(0)}MB limit`);
      }

      // [QUALITY] Baseline log of exactly what was received, before HEIC
      // conversion or anything else touches it. Skipped silently for HEIC —
      // sharp's prebuilt binary can't decode it — the HEIC conversion log
      // below covers that case instead.
      try {
        const receivedMeta = await sharp(file.buffer).metadata();
        this.logger.log(
          `[QUALITY] Upload received: ${receivedMeta.width}x${receivedMeta.height}, ${(file.buffer.length / 1024).toFixed(0)}KB, format: ${receivedMeta.format}, device orientation: ${receivedMeta.orientation || 'none'}`,
        );
      } catch {
        // Not decodable by sharp (e.g. HEIC) — nothing to log yet.
      }

      // iPhones shoot HEIC/HEIF by default. Most browsers already convert to
      // JPEG before upload, but not all paths do (native pickers, some
      // Android "share as-is" flows), so this has to be detected from either
      // the declared mimetype or the filename, not assumed away.
      const isHeic =
        file.mimetype === 'image/heic' ||
        file.mimetype === 'image/heif' ||
        /\.(heic|heif)$/i.test(file.originalname || '');

      const allowedTypes = (
        this.config.get<string>('ALLOWED_MIME_TYPES') || 'image/jpeg,image/png,image/webp,image/heic,image/heif'
      ).split(',');
      if (!isHeic && !allowedTypes.includes(file.mimetype)) {
        throw new BadRequestException('Invalid file type. Allowed: ' + allowedTypes.join(', '));
      }

      // sharp's prebuilt binary can't decode HEIC, so every check below
      // (content validation, orientation, storage) has to run against a
      // converted JPEG buffer instead of the raw HEIC bytes. Non-HEIC uploads
      // are left completely untouched — see the no-resize/no-re-encode note
      // in step 4.
      photoBuffer = file.buffer;
      photoMimeType = file.mimetype;

      if (isHeic) {
        try {
          this.logger.log('Converting HEIC to JPEG...');
          const jpegBuffer = await heicConvert({ buffer: file.buffer, format: 'JPEG', quality: 0.95 });
          photoBuffer = Buffer.from(jpegBuffer);
          photoMimeType = 'image/jpeg';
          const path = await import('path');
          photoFilename = `${path.basename(file.originalname || 'photo', path.extname(file.originalname || ''))}.jpg`;
        } catch (err: any) {
          throw new BadRequestException('Could not read this HEIC photo: ' + err.message);
        }
      }

      // The Content-Type header above is client-supplied and trivially spoofed
      // (rename a .txt to .jpg) — this actually decodes the file to confirm
      // its real format, the same check AssetsService uses for backgrounds/
      // frames/props.
      const contentValidation = await ImageOptimizer.validateImage(photoBuffer);
      if (!contentValidation.valid) {
        throw new BadRequestException('Uploaded file is not a valid image');
      }

      // 4. Detect orientation — the uploaded photo is stored and used exactly
      // as submitted (post-HEIC-conversion, if applicable), no resize or
      // re-encode beyond that. It used to be JPEG/PNG re-compressed at quality
      // 90 (and downscaled if larger than the campaign's output dimensions)
      // here, which lost quality on every single submission before the AI
      // provider or the person ever saw it.
      const photoSettings = (campaign.photoSettings as any) || {};
      optimizedBuffer = photoBuffer;

      try {
        const metadata = await sharp(photoBuffer).metadata();
        orientation = dto.orientation || photoSettings.orientation ||
          (metadata.width > metadata.height ? 'landscape' : 'portrait');

        this.logger.log(
          isHeic
            ? `[QUALITY] HEIC input (${(file.buffer.length / 1024).toFixed(0)}KB) → converted JPEG ${metadata.width}x${metadata.height} (${(optimizedBuffer.length / 1024).toFixed(0)}KB)`
            : `[QUALITY] After optimization: ${metadata.width}x${metadata.height}, ${(optimizedBuffer.length / 1024).toFixed(0)}KB, format: ${metadata.format}`,
        );

        // Compared against the true original bytes (file.buffer), not
        // photoBuffer — for a HEIC upload photoBuffer IS the already-converted
        // JPEG, so comparing it to itself could never catch a real regression.
        // sharp can't decode HEIC, so this comparison is skipped for that case.
        if (!isHeic) {
          try {
            const rawMeta = await sharp(file.buffer).metadata();
            const baselineWidth = rawMeta.width || 0;
            const baselineHeight = rawMeta.height || 0;
            if (
              (metadata.width || 0) < baselineWidth * 0.9 ||
              (metadata.height || 0) < baselineHeight * 0.9
            ) {
              this.logger.warn(
                `[QUALITY WARNING] Photo was resized! Original: ${baselineWidth}x${baselineHeight} → Saved: ${metadata.width}x${metadata.height}. This reduces face accuracy.`,
              );
            } else {
              this.logger.log('[QUALITY OK] Photo dimensions preserved at upload.');
            }
          } catch {
            // best-effort comparison only
          }
        }
      } catch (err) {
        this.logger.warn('Orientation detection failed, defaulting: ' + err.message);
        orientation = dto.orientation || photoSettings.orientation || 'portrait';
      }
    }

    // A video's container format is only reliably known from its (already
    // validated) mimetype — the client-supplied originalname can't be
    // trusted for this (e.g. a stale "photo.png" left over from before video
    // support existed would otherwise silently win below, saving real video
    // bytes under a .png name). Overwriting photoFilename here means both
    // the S3 upload (StorageService.upload derives its extension from this
    // name) and the local-disk fallback below pick up the right extension
    // from one place instead of duplicating this mapping in both.
    if (isVideo) {
      const videoExtensionByMimeType: Record<string, string> = {
        'video/webm': '.webm',
        'video/mp4': '.mp4',
        'video/quicktime': '.mov',
        'video/x-matroska': '.mkv',
      };
      photoFilename = `video${videoExtensionByMimeType[photoMimeType] || '.webm'}`;
    }

    // 5. Upload original photo/video. Video submissions get their own
    // "videos" folder instead of "originals" — keeps them out of the
    // photo-processing pipeline's storage area entirely (nothing there ever
    // scans/composites over them) and makes them easy to find/manage
    // separately (e.g. bulk export, retention policy) from processed photos.
    const assetFolder = isVideo ? 'videos' : 'originals';
    const defaultExt = isVideo ? '.webm' : '.jpg';
    let originalUrl: string;
    const useS3 = this.storage.isConfigured();

    if (useS3) {
      originalUrl = await this.storage.upload(
        optimizedBuffer,
        this.storage.getCampaignPath(campaign.slug, assetFolder),
        photoFilename,
        photoMimeType,
      );
    } else {
      // Local fallback. Note the stored value is a bare relative path
      // ("campaigns/.../originals/x.jpg", no leading "/uploads/") — different
      // from AssetsService's convention of storing the full "/uploads/..."
      // URL. deleteSubmission() below and any future reader of originalUrl
      // must remember to join it with the uploads root themselves.
      const fs = await import('fs/promises');
      const path = await import('path');
      const uploadDir = path.join(process.cwd(), 'uploads', 'campaigns', campaign.slug, assetFolder);
      await fs.mkdir(uploadDir, { recursive: true });
      const filename = `${uuid()}${path.extname(photoFilename) || defaultExt}`;
      const filepath = path.join(uploadDir, filename);
      await fs.writeFile(filepath, optimizedBuffer);
      originalUrl = `campaigns/${campaign.slug}/${assetFolder}/${filename}`;
    }

    // 6. Processing mode already resolved above (step 2b), for the
    // template/prompt-option validation. Video submissions get their own
    // "video" tag instead — there's no AI/non-ai processing step for them
    // at all (see step 8).
    const submissionMode = isVideo ? 'video' : mode;

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
        mode: submissionMode,
        backgroundUsed: dto.backgroundId || null,
        frameUsed: dto.frameId || null,
        templateUsed: dto.templateId || null,
        // promptUsed is set here from the selected option's/custom input's
        // resolved text so it's visible on the submission immediately, not
        // just after processing completes — ProcessingWorker resolves the
        // same value again at generation time (effectiveAiConfig.prompt) and
        // re-writes it once the job finishes, so this is a head start, not
        // the only writer.
        promptOptionId: promptOption?.id || null,
        customInput: customInputRaw,
        promptUsed: promptOption?.prompt || customInputPrompt || null,
        propsUsed: dto.propIds || [],
        orientation,
        styleUsed: dto.styleUsed || null,
      },
    });

    this.logger.log(`Submission created: ${submission.id} for campaign ${campaign.slug}`);

    // 8. Enqueue for processing — video submissions skip this entirely.
    // ProcessingWorker's background/frame compositing and AI generation are
    // photo-only; a video is stored as-is and considered done the moment
    // the upload succeeds (this campaign's UX never shows a result back).
    let finalStatus: string;
    if (isVideo) {
      await this.prisma.submission.update({
        where: { id: submission.id },
        data: { status: 'COMPLETED', resultUrl: originalUrl },
      });
      finalStatus = 'COMPLETED';
    } else {
      await this.queueService.addJob(submission.id);
      await this.prisma.submission.update({ where: { id: submission.id }, data: { status: 'QUEUED' } });
      finalStatus = 'QUEUED';
    }

    // 9. Notify admin dashboards in real time
    this.websocketGateway.notifyNewSubmission({
      submissionId: submission.id,
      campaignSlug: campaign.slug,
      userName: dto.userName,
      mode: submissionMode,
    });
    this.websocketGateway.notifyQueueStats(await this.queueService.getQueueStats());

    // 10. Return submission ID — the booth will poll for status
    return {
      submissionId: submission.id,
      status: finalStatus,
      message: isVideo
        ? 'Video uploaded successfully.'
        : 'Photo uploaded successfully. Processing will begin shortly.',
    };
  }

  // ─── DISPLAY URL RESOLUTION ───
  // Storage keys (S3 keys or bare local-disk relative paths) aren't directly
  // usable by a browser — S3 needs a signed URL, local needs the "/uploads/"
  // prefix main.ts's static middleware serves from. Shared by getStatus()
  // (booth polling) and the admin findAll()/findById() below (dashboard
  // listing/detail, and the download/print buttons there), so there's one
  // implementation of "how do I turn a stored key into something a client
  // can load" instead of three.

  private resolveDisplayUrl(key: string | null | undefined): Promise<string | null> {
    return this.storage.resolveUrl(key);
  }

  private async attachDisplayUrls<
    T extends { status: string; resultUrl: string | null; thumbnailUrl: string | null; qrCodeUrl: string | null },
  >(submission: T): Promise<T> {
    // Only a COMPLETED submission has real files behind these keys — for
    // any other status they're already null/not yet written, so skip the
    // (for S3) network round-trip entirely.
    if (submission.status !== 'COMPLETED') return submission;

    const [resultUrl, thumbnailUrl, qrCodeUrl] = await Promise.all([
      this.resolveDisplayUrl(submission.resultUrl),
      this.resolveDisplayUrl(submission.thumbnailUrl),
      this.resolveDisplayUrl(submission.qrCodeUrl),
    ]);
    return { ...submission, resultUrl, thumbnailUrl, qrCodeUrl };
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
        displayCode: true,
        downloadCodeExpiresAt: true,
        errorMessage: true,
        processingTime: true,
        createdAt: true,
        updatedAt: true,
        campaign: { select: { deliveryConfig: true, qrConfig: true } },
      },
    });

    if (!submission) throw new NotFoundException('Submission not found');

    const response: any = {
      submissionId: submission.id,
      status: submission.status,
      createdAt: submission.createdAt,
    };

    if (submission.status === 'COMPLETED') {
      const resolved = await this.attachDisplayUrls(submission);
      response.resultUrl = resolved.resultUrl;
      response.qrCodeUrl = resolved.qrCodeUrl;
      response.thumbnailUrl = resolved.thumbnailUrl;
      response.processingTime = submission.processingTime;

      // See the matching comment in DeliveryService.generateDelivery —
      // ADMIN_URL is the app that actually serves /dl/[code] and /download;
      // FRONTEND_URL isn't.
      const baseUrl = this.config.get<string>('ADMIN_URL') || 'http://localhost:3002';
      const deliveryCfg = this.deliveryService.resolveDeliveryConfig(submission.campaign);
      const delivery: any = {
        qrCode: { enabled: !!resolved.qrCodeUrl },
        shortCode: { enabled: deliveryCfg.shortCode?.enabled !== false && !!submission.downloadCode },
        directLink: { enabled: deliveryCfg.directLink?.enabled === true && !!submission.downloadCode },
      };

      if (resolved.qrCodeUrl) {
        delivery.qrCode.imageUrl = resolved.qrCodeUrl;
      }

      if (submission.downloadCode) {
        const downloadUrl = `${baseUrl}/dl/${submission.downloadCode}`;
        if (resolved.qrCodeUrl) delivery.qrCode.downloadUrl = downloadUrl;
        delivery.shortCode.code = submission.displayCode || submission.downloadCode;
        delivery.shortCode.instructions = `Go to ${baseUrl}/download and enter this code`;
        delivery.directLink.url = downloadUrl;
        delivery.directLink.expiresAt = submission.downloadCodeExpiresAt;

        // Flat fields kept for backward compatibility with anything already
        // reading downloadUrl/downloadCode directly off the status response.
        response.downloadUrl = downloadUrl;
        response.downloadCode = submission.downloadCode;
        response.displayCode = submission.displayCode;
      }

      response.delivery = delivery;
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

  async findAll(filters?: {
    campaignId?: string;
    status?: string;
    mode?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};
    if (filters?.campaignId) where.campaignId = filters.campaignId;
    if (filters?.status) where.status = filters.status;
    // "video" is a real, always-set value of this same field (see
    // submitPhoto's submissionMode) — not a separate submissionType column —
    // so the Videos admin page filters on it directly instead of guessing
    // from resultUrl's extension, which HEIC-style edge cases could fool.
    if (filters?.mode) where.mode = filters.mode;
    if (filters?.search) {
      where.OR = [
        { userName: { contains: filters.search } },
        { userEmail: { contains: filters.search } },
      ];
    }

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

    // Resolves resultUrl/thumbnailUrl/qrCodeUrl to something a browser can
    // actually load (presigned S3 URL, or the local "/uploads/" path) —
    // without this, the admin dashboard's download/print buttons would get
    // a bare, unusable storage key instead. See attachDisplayUrls above.
    const resolvedSubmissions = await Promise.all(submissions.map((s) => this.attachDisplayUrls(s)));

    return { submissions: resolvedSubmissions, total, limit: filters?.limit || 50, offset: filters?.offset || 0 };
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
    return this.attachDisplayUrls(submission);
  }

  // ─── ADMIN: PRINT SUBMISSION ───

  // Atomically claims the print (NOT_PRINTED/FAILED -> PRINT_REQUESTED) with
  // a conditional updateMany rather than a plain update, so two concurrent
  // requests for the same submission can't both succeed — MySQL takes a row
  // lock during the UPDATE, so only the first request's WHERE still matches
  // by the time it actually runs; the second gets affected count 0 and is
  // told alreadyPrinted instead of also "succeeding".
  //
  // There is no real printer-hardware integration anywhere in this codebase
  // (see the PrintStatus comment in schema.prisma) — the actual physical
  // print happens client-side via the browser's window.print(), which has
  // no completion callback for any code, frontend or backend, to await. So
  // PRINT_REQUESTED and PRINTED happen back-to-back in this one call;
  // PRINTING/FAILED stay in the enum for a real printer integration to use
  // later (a future call to send the job to actual hardware would go
  // between the claim and the finalize below, and could finalize to FAILED
  // with printError set instead of PRINTED on a real hardware failure).
  async print(id: string, printerId?: string) {
    const claim = await this.prisma.submission.updateMany({
      where: { id, printStatus: { in: ['NOT_PRINTED', 'FAILED'] } },
      data: {
        printStatus: 'PRINT_REQUESTED',
        printerId: printerId ?? undefined,
        printAttempts: { increment: 1 },
        printError: null,
      },
    });

    if (claim.count === 0) {
      // Didn't win the claim — disambiguate why: doesn't exist, a concurrent
      // request just claimed it (still PRINT_REQUESTED/PRINTING), or it was
      // genuinely already printed already. All but "doesn't exist" report
      // the same alreadyPrinted:true shape to the caller.
      const submission = await this.prisma.submission.findUnique({
        where: { id },
        select: { printStatus: true, printedAt: true },
      });
      if (!submission) throw new NotFoundException('Submission not found');

      if (submission.printStatus === 'PRINT_REQUESTED' || submission.printStatus === 'PRINTING') {
        return { success: false, alreadyPrinted: true, message: 'This image is already being printed.' };
      }
      return {
        success: false,
        alreadyPrinted: true,
        message: 'This image has already been printed.',
        printedAt: submission.printedAt,
      };
    }

    // Won the claim — verify there's actually a completed result before
    // finalizing. A submission that's still processing (or has none) should
    // never be markable PRINTED; roll the claim back to FAILED (not
    // NOT_PRINTED) so printAttempts/printError stay visible and it's still
    // retryable once it does complete.
    const submission = await this.prisma.submission.findUnique({
      where: { id },
      select: { status: true, resultUrl: true },
    });
    if (!submission || submission.status !== 'COMPLETED' || !submission.resultUrl) {
      await this.prisma.submission.update({
        where: { id },
        data: { printStatus: 'FAILED', printError: 'No completed result available to print' },
      });
      throw new BadRequestException('This submission has no completed result to print yet');
    }

    const printed = await this.prisma.submission.update({
      where: { id },
      data: { printStatus: 'PRINTED', printedAt: new Date() },
      select: { printedAt: true },
    });

    this.logger.log(`Submission ${id} marked as printed${printerId ? ` (printer: ${printerId})` : ''}`);

    return {
      success: true,
      alreadyPrinted: false,
      message: 'Print recorded successfully.',
      printedAt: printed.printedAt,
    };
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


