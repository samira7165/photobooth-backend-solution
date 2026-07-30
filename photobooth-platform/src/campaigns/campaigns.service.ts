import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

@Injectable()
export class CampaignsService {
  constructor(private prisma: PrismaService) {}

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

    const campaign = await this.prisma.campaign.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        processingMode: dto.processingMode || 'non-ai',
        brandConfig: dto.brandConfig || {},
        aiConfig: dto.aiConfig || {},
        photoSettings: dto.photoSettings || { orientation: 'portrait', outputWidth: 1080, outputHeight: 1920 },
        backgroundConfig: dto.backgroundConfig || { removal: false, allowCustomUpload: false },
        frameConfig: dto.frameConfig || { enabled: false },
        propConfig: dto.propConfig || { enabled: false },
        qrConfig: dto.qrConfig || { enabled: true, position: { x: 900, y: 1750 }, size: 150, contentType: 'download-link' },
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

    return campaign;
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

  // ─── BOOTH-FACING ENDPOINT (PUBLIC) ───
  // Returns only what the booth client needs — branding, active props/frames/backgrounds
  async getBoothConfig(slug: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { slug },
      include: {
        backgrounds: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, thumbnailUrl: true, imageUrl: true } },
        frames: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, thumbnailUrl: true, imageUrl: true } },
        props: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, thumbnailUrl: true, imageUrl: true, positionType: true } },
      },
    });

    if (!campaign || campaign.status !== 'ACTIVE') {
      throw new NotFoundException('Campaign not found or not active');
    }

    return {
      name: campaign.name,
      slug: campaign.slug,
      branding: campaign.brandConfig,
      photoSettings: campaign.photoSettings,
      collectFields: campaign.collectFields,
      outputMode: campaign.outputMode,
      backgrounds: campaign.backgrounds,
      frames: campaign.frames,
      props: campaign.props,
      backgroundConfig: campaign.backgroundConfig,
      frameConfig: campaign.frameConfig,
      propConfig: campaign.propConfig,
      textConfig: campaign.textConfig,
    };
  }
}
