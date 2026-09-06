import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { DeveloperKeysService } from '../developer-keys/developer-keys.service';
import { CorsService } from '../common/services/cors.service';
import { DeliveryService } from '../delivery/delivery.service';

// Campaign status follows a one-way state machine (see updateStatus below):
// DRAFT -> ACTIVE -> PAUSED/COMPLETED -> ARCHIVED. Only updateStatus() is
// allowed to change status — the generic update() rejects it outright — so
// the transition rules can't be bypassed by a plain PATCH.
@Injectable()
export class CampaignsService {
  constructor(
    private prisma: PrismaService,
    private developerKeysService: DeveloperKeysService,
    private config: ConfigService,
    private corsService: CorsService,
    private deliveryService: DeliveryService,
  ) {}

  async create(dto: CreateCampaignDto, userId: string) {
    // Check slug uniqueness
    const existing = await this.prisma.campaign.findUnique({ where: { slug: dto.slug } });
    if (existing) {
      throw new ConflictException('Campaign slug already exists');
    }

    // Validate slug format (lowercase, hyphens, no spaces)
    if (!/^[a-z0-9-]+$/.test(dto.slug)) {
      throw new BadRequestException('Slug must be lowercase letters, numbers, and hyphens only');
    }

    this.validateDeliveryConfig(dto.deliveryConfig);

    const campaign = await this.prisma.campaign.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        processingMode: dto.processingMode || 'non-ai',
        aiConfig: dto.aiConfig || {},
        photoSettings: dto.photoSettings || { orientation: 'portrait', outputWidth: 1080, outputHeight: 1920 },
        backgroundConfig: dto.backgroundConfig || { removal: false, allowCustomUpload: false },
        frameConfig: dto.frameConfig || { enabled: false },
        propConfig: dto.propConfig || { enabled: false },
        qrConfig: dto.qrConfig || { enabled: true, position: { x: 900, y: 1750 }, size: 150, contentType: 'download-link' },
        // Left unset (null) unless explicitly provided — resolveDeliveryConfig
        // treats a null deliveryConfig as "fall back to qrConfig", which is
        // exactly the right behavior for a campaign that never opted into
        // multi-method delivery, not just for ones created before it existed.
        ...(dto.deliveryConfig && { deliveryConfig: dto.deliveryConfig }),
        textConfig: dto.textConfig || { enabled: false },
        collectFields: dto.collectFields || ['name', 'phone'],
        outputMode: dto.outputMode || 'qr',
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        maxSubmissions: dto.maxSubmissions || null,
        dailyBudget: dto.dailyBudget || null,
        totalBudget: dto.totalBudget || null,
      },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'campaign.created',
        entityType: 'campaign',
        entityId: campaign.id,
        metadata: { name: campaign.name, slug: campaign.slug },
      },
    });

    // A new campaign can carry its own allowedOrigins — clear CorsService's
    // cache so main.ts's CORS check sees it on the very next request instead
    // of waiting out the 5-minute TTL.
    this.corsService.clearCache();

    // Every new campaign gets a first developer API key automatically, so
    // there's always something immediately usable to hand an external
    // developer. This has to happen here, in the same request as creation —
    // the plaintext key only ever exists in THIS response; it's never
    // stored or retrievable again after this (see DeveloperKeysService).
    const key = await this.developerKeysService.generateKey(campaign.id, 'Default Integration Key', { mode: 'live' });

    return {
      ...campaign,
      integrationConfig: this.buildIntegrationConfig(campaign, key.key, key.keyPrefix),
    };
  }

  private buildIntegrationConfig(
    campaign: { slug: string; name: string; processingMode: string; collectFields: any; outputMode: string },
    apiKey: string,
    keyPrefix: string,
  ) {
    const apiBaseUrl = this.config.get<string>('PUBLIC_API_URL') || 'http://localhost:3000/api/v1/public';

    return {
      campaignSlug: campaign.slug,
      campaignName: campaign.name,
      apiBaseUrl,
      authHeader: 'x-api-key',
      apiKey,
      keyPrefix,
      processingMode: campaign.processingMode,
      collectFields: campaign.collectFields,
      outputMode: campaign.outputMode,
      endpoints: {
        config: 'GET /config — campaign settings, backgrounds, frames, props, templates',
        session: 'POST /session — start a booth session (optional, body: { hallId? })',
        submit: 'POST /submit — multipart upload, field "photo" + form fields (see collectFields)',
        status: 'GET /status/:submissionId — poll until status is COMPLETED or FAILED',
        download: 'GET /download/:code — result photo info for a completed submission',
      },
      generatedAt: new Date().toISOString(),
      warning: 'apiKey is shown only once, right now, and is never stored in recoverable form. If lost, download the integration config again from the campaign page — that issues a fresh key; the previous one keeps working until revoked separately.',
    };
  }

  // Lets an admin pull a working integration config for a campaign at any
  // time after creation, not just the one shown once on the create screen —
  // the plaintext of a DeveloperApiKey is never stored, so "downloading it
  // again" isn't recovering the original key, it's issuing a new one under
  // the same campaign and packaging it the same way. Old keys are left
  // alone (see DeveloperKeysController.revoke to retire one deliberately).
  async regenerateIntegrationConfig(campaignId: string, userId: string) {
    const campaign = await this.findById(campaignId);

    const key = await this.developerKeysService.generateKey(
      campaign.id,
      `Integration Key (${new Date().toISOString().slice(0, 10)})`,
      { mode: 'live' },
    );

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'campaign.integration_config_regenerated',
        entityType: 'campaign',
        entityId: campaign.id,
        metadata: { keyPrefix: key.keyPrefix },
      },
    });

    return this.buildIntegrationConfig(campaign, key.key, key.keyPrefix);
  }

  async findAll(filters?: { status?: string }) {
    const where: any = {};
    if (filters?.status) {
      where.status = filters.status;
    }

    return this.prisma.campaign.findMany({
      where,
      include: {
        _count: {
          select: { submissions: true, backgrounds: true, frames: true, props: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Slug-based lookup with only active assets included. Not currently called
  // by any controller route (getBoothConfig below is the public slug-based
  // lookup actually in use) — kept for future admin/internal use.
  async findBySlug(slug: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { slug },
      include: {
        backgrounds: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        frames: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        props: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
        _count: { select: { submissions: true } },
      },
    });

    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async findById(id: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        backgrounds: { orderBy: { sortOrder: 'asc' } },
        frames: { orderBy: { sortOrder: 'asc' } },
        props: { orderBy: { sortOrder: 'asc' } },
        templates: { orderBy: { sortOrder: 'asc' } },
        apiKeyLinks: {
          include: {
            apiKey: {
              select: {
                id: true,
                keyIdentifier: true,
                isActive: true,
                usageToday: true,
                dailyLimit: true,
                provider: true,
              },
            },
          },
        },
        _count: { select: { submissions: true } },
      },
    });

    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async update(id: string, dto: UpdateCampaignDto, userId: string) {
    await this.findById(id); // throws if not found

    // Status changes must go through updateStatus() so the DRAFT -> ACTIVE -> ...
    // transition rules are enforced. Allowing it here would let a caller skip
    // straight from DRAFT to ARCHIVED, for example.
    if (dto.status) {
      throw new BadRequestException('Use PATCH /campaigns/:id/status to change campaign status');
    }

    // If slug is being changed, check uniqueness
    if (dto.slug) {
      if (!/^[a-z0-9-]+$/.test(dto.slug)) {
        throw new BadRequestException('Slug must be lowercase letters, numbers, and hyphens only');
      }
      const existing = await this.prisma.campaign.findFirst({
        where: { slug: dto.slug, NOT: { id } },
      });
      if (existing) {
        throw new ConflictException('Campaign slug already exists');
      }
    }

    this.validateDeliveryConfig(dto.deliveryConfig);

    const data: any = { ...dto };
    if (dto.startDate) data.startDate = new Date(dto.startDate);
    if (dto.endDate) data.endDate = new Date(dto.endDate);

    const campaign = await this.prisma.campaign.update({
      where: { id },
      data,
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'campaign.updated',
        entityType: 'campaign',
        entityId: campaign.id,
        metadata: { changes: Object.keys(dto) },
      },
    });

    // allowedOrigins may have just changed — clear CorsService's cache so
    // the new value takes effect immediately instead of waiting out the TTL.
    this.corsService.clearCache();

    return campaign;
  }

  async updateStatus(id: string, status: string, userId: string) {
    const campaign = await this.findById(id);

    // Validate status transitions
    const validTransitions: Record<string, string[]> = {
      DRAFT: ['ACTIVE'],
      ACTIVE: ['PAUSED', 'COMPLETED'],
      PAUSED: ['ACTIVE', 'COMPLETED'],
      COMPLETED: ['ARCHIVED'],
      ARCHIVED: [],
    };

    const allowed = validTransitions[campaign.status] || [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Cannot transition from ${campaign.status} to ${status}. Allowed: ${allowed.join(', ') || 'none'}`,
      );
    }

    // Catches the exact misconfiguration a "Prothom Alo"-style campaign
    // shipped with: AI mode, promptMode left at its "template" default, no
    // template AND no default aiConfig.prompt — every submission would
    // silently send Gemini/DALL-E the hardcoded generic fallback
    // ('Enhance this photo', see ProcessingService.DEFAULT_PROMPT) instead
    // of anything the admin actually intended, with no error anywhere to
    // notice. This is a go-live gate, not the only protection — see the
    // matching per-submission check in SubmissionsService.submitPhoto,
    // which also covers a later edit that breaks an already-ACTIVE campaign.
    if (status === 'ACTIVE' && (campaign.processingMode === 'ai' || campaign.processingMode === 'both')) {
      const aiConfig = (campaign.aiConfig as any) || {};
      const promptMode = aiConfig.promptMode || 'template';
      const hasDefaultPrompt = !!aiConfig.prompt?.trim();

      if (promptMode === 'prompt-option' || promptMode === 'both') {
        const activeOptionCount = await this.prisma.promptOption.count({ where: { campaignId: id, isActive: true } });
        const hasCustomInput = !!aiConfig.customInput?.enabled && !!aiConfig.customInput?.promptTemplate?.trim();
        if (promptMode === 'prompt-option' && activeOptionCount === 0 && !hasCustomInput) {
          throw new BadRequestException(
            'Cannot activate: this campaign is set to Prompt Options mode but has no active prompt options and no custom-input prompt template configured. Add at least one prompt option, or enable custom input with a template, before going live.',
          );
        }
      }

      if (promptMode === 'template') {
        const hasActiveTemplateWithPrompt = (campaign.templates || []).some((t: any) => t.isActive && t.prompt?.trim());
        if (!hasDefaultPrompt && !hasActiveTemplateWithPrompt) {
          throw new BadRequestException(
            'Cannot activate: this AI campaign has no default AI prompt set and no active template with its own prompt. Every submission would silently use a generic fallback prompt instead of your intended one — set a default AI prompt, add a template with a prompt, or switch to Prompt Options mode first.',
          );
        }
      }
    }

    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: status as any },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'campaign.status_changed',
        entityType: 'campaign',
        entityId: id,
        metadata: { from: campaign.status, to: status },
      },
    });

    return updated;
  }

  async delete(id: string, userId: string) {
    const campaign = await this.findById(id);

    if (campaign.status === 'ACTIVE') {
      throw new BadRequestException('Cannot delete an active campaign. Pause or complete it first.');
    }

    await this.prisma.campaign.delete({ where: { id } });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'campaign.deleted',
        entityType: 'campaign',
        entityId: id,
        metadata: { name: campaign.name, slug: campaign.slug },
      },
    });

    return { message: 'Campaign deleted successfully' };
  }

  // Enforces the specific business rules deliveryConfig needs that plain
  // class-validator can't express on a loosely-typed @IsObject() field (the
  // same shallow-typing convention every other JSON config field on
  // CreateCampaignDto already uses — see aiConfig/qrConfig/etc.).
  private validateDeliveryConfig(deliveryConfig: any): void {
    if (!deliveryConfig) return;

    const prefix = deliveryConfig.shortCode?.prefix;
    if (prefix !== undefined && prefix !== null) {
      if (typeof prefix !== 'string' || prefix.length > 10 || !/^[A-Z0-9]*$/.test(prefix)) {
        throw new BadRequestException('deliveryConfig.shortCode.prefix must be up to 10 uppercase alphanumeric characters');
      }
    }

    const codeLength = deliveryConfig.shortCode?.codeLength;
    if (codeLength !== undefined && codeLength !== null) {
      if (!Number.isInteger(codeLength) || codeLength < 4 || codeLength > 8) {
        throw new BadRequestException('deliveryConfig.shortCode.codeLength must be an integer between 4 and 8');
      }
    }

    const expiryHours = deliveryConfig.directLink?.expiryHours;
    if (expiryHours !== undefined && expiryHours !== null) {
      if (!Number.isInteger(expiryHours) || expiryHours < 1 || expiryHours > 168) {
        throw new BadRequestException('deliveryConfig.directLink.expiryHours must be an integer between 1 and 168 (1 week max)');
      }
    }
  }

  // ─── BOOTH-FACING ENDPOINT (PUBLIC) ───
  // Returns only what the booth client needs — settings, active props/frames/backgrounds
  async getBoothConfig(slug: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { slug },
      include: {
        backgrounds: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, thumbnailUrl: true, imageUrl: true } },
        frames: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, thumbnailUrl: true, imageUrl: true } },
        props: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, thumbnailUrl: true, imageUrl: true, positionType: true } },
        // No `prompt` here — that's a generation detail for the backend only,
        // never sent to the public booth endpoint.
        templates: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, thumbnailUrl: true, imageUrl: true } },
        // Same reasoning as templates above: `prompt` is never selected here.
        // The booth only needs enough to render a selection screen.
        promptOptions: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, description: true, thumbnailUrl: true, sortOrder: true } },
      },
    });

    if (!campaign || campaign.status !== 'ACTIVE') {
      throw new NotFoundException('Campaign not found or not active');
    }

    const aiConfig = (campaign.aiConfig as any) || {};
    const customInputConfig = aiConfig.customInput || {};

    return {
      name: campaign.name,
      slug: campaign.slug,
      photoSettings: campaign.photoSettings,
      collectFields: campaign.collectFields,
      outputMode: campaign.outputMode,
      backgrounds: campaign.backgrounds,
      frames: campaign.frames,
      props: campaign.props,
      templates: campaign.templates,
      // Unset defaults to "template" — existing campaigns (created before
      // this field existed) keep behaving exactly as they do today.
      promptMode: aiConfig.promptMode || 'template',
      promptOptions: campaign.promptOptions,
      // Only enough for the booth to render an "Other" input — promptTemplate
      // is internal generation detail, same treatment as PromptOption.prompt
      // above, never sent here.
      customInput: {
        enabled: !!customInputConfig.enabled,
        label: customInputConfig.label || 'Type your own...',
        maxLength: customInputConfig.maxLength || 50,
      },
      backgroundConfig: campaign.backgroundConfig,
      frameConfig: campaign.frameConfig,
      propConfig: campaign.propConfig,
      textConfig: campaign.textConfig,
      // Resolved (not raw) — a campaign with only the legacy qrConfig gets
      // the exact same shape back, with shortCode/directLink/print at their
      // backward-compatible defaults, so the booth never has to know
      // whether this campaign has deliveryConfig or is still on qrConfig.
      deliveryConfig: this.deliveryService.resolveDeliveryConfig(campaign),
    };
  }
}
