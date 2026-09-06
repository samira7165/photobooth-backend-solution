import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ImageOptimizer } from '../common/utils/image-optimizer';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { CreatePromptOptionDto } from './dto/create-prompt-option.dto';
import { UpdatePromptOptionDto } from './dto/update-prompt-option.dto';

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');

// A PromptOption is a booth-selectable text prompt with no reference image
// (see the PromptOption model comment in schema.prisma) — the only file
// involved is an optional preview thumbnail, so this is a much smaller
// cousin of AssetsService rather than a fifth AssetKind bolted onto it.
@Injectable()
export class PromptOptionsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  private async getCampaignOrThrow(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  private async findOrThrow(id: string) {
    const option = await this.prisma.promptOption.findUnique({ where: { id } });
    if (!option) throw new NotFoundException('Prompt option not found');
    return option;
  }

  private async saveThumbnail(campaign: { id: string; slug: string }, file: Express.Multer.File): Promise<string> {
    const validation = await ImageOptimizer.validateImage(file.buffer);
    if (!validation.valid) {
      throw new BadRequestException('Uploaded thumbnail is not a valid image');
    }
    const thumbBuffer = await sharp(file.buffer).resize({ width: 200 }).jpeg({ quality: 70 }).toBuffer();

    if (this.storage.isConfigured()) {
      const key = `${this.storage.getCampaignPath(campaign.slug, 'prompt-options')}/${randomUUID()}-thumb.jpg`;
      await this.storage.uploadWithKey(thumbBuffer, key, 'image/jpeg');
      return key;
    }

    // Development fallback: no AWS credentials configured, save to local disk.
    const dir = path.join(UPLOAD_ROOT, 'campaigns', campaign.id, 'prompt-options');
    await fs.mkdir(dir, { recursive: true });
    const filename = `${randomUUID()}-thumb.jpg`;
    await fs.writeFile(path.join(dir, filename), thumbBuffer);
    return `/uploads/campaigns/${campaign.id}/prompt-options/${filename}`;
  }

  // Same local-vs-S3 routing-by-URL-shape as AssetsService.deleteAssetFiles.
  private async deleteThumbnail(thumbnailUrl?: string | null) {
    if (!thumbnailUrl) return;
    if (thumbnailUrl.startsWith('/uploads/')) {
      const filePath = path.join(process.cwd(), thumbnailUrl.replace(/^\//, ''));
      await fs.unlink(filePath).catch(() => undefined);
    } else {
      await this.storage.delete(thumbnailUrl);
    }
  }

  async create(dto: CreatePromptOptionDto, file: Express.Multer.File | undefined, userId: string) {
    const campaign = await this.getCampaignOrThrow(dto.campaignId);
    const thumbnailUrl = file ? await this.saveThumbnail(campaign, file) : null;

    const created = await this.prisma.promptOption.create({
      data: {
        campaignId: dto.campaignId,
        name: dto.name,
        description: dto.description ?? null,
        prompt: dto.prompt,
        thumbnailUrl,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'promptOption.created',
        entityType: 'promptOption',
        entityId: created.id,
        metadata: { campaignId: dto.campaignId, name: dto.name },
      },
    });

    return created;
  }

  async findAllByCampaign(campaignId: string, includeInactive = false) {
    return this.prisma.promptOption.findMany({
      where: includeInactive ? { campaignId } : { campaignId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findById(id: string) {
    return this.findOrThrow(id);
  }

  async update(id: string, dto: UpdatePromptOptionDto, file: Express.Multer.File | undefined, userId: string) {
    const existing = await this.findOrThrow(id);

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.prompt !== undefined) data.prompt = dto.prompt;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    if (file) {
      const campaign = await this.getCampaignOrThrow(existing.campaignId);
      data.thumbnailUrl = await this.saveThumbnail(campaign, file);
    }

    const updated = await this.prisma.promptOption.update({ where: { id }, data });

    if (file) {
      await this.deleteThumbnail(existing.thumbnailUrl);
    }

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'promptOption.updated',
        entityType: 'promptOption',
        entityId: id,
        metadata: { changes: Object.keys(data) },
      },
    });

    return updated;
  }

  async delete(id: string, userId: string) {
    const existing = await this.findOrThrow(id);

    // promptOptionId on Submission is onDelete: SetNull (see schema.prisma),
    // so this never touches submission history — only forgets which option
    // a past submission used.
    await this.prisma.promptOption.delete({ where: { id } });
    await this.deleteThumbnail(existing.thumbnailUrl);

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'promptOption.deleted',
        entityType: 'promptOption',
        entityId: id,
        metadata: { name: existing.name },
      },
    });

    return { message: 'Prompt option deleted successfully' };
  }

  // Unlike AssetsService.reorderAssets (which takes a campaignId and
  // requires the full ordered set for that campaign), this takes a bare id
  // list and derives the campaign from the rows themselves — matching the
  // requested `POST /prompt-options/reorder { ids: [...] }` shape. Every id
  // must exist and all must belong to the same campaign; sortOrder is then
  // set to the id's index in the array.
  async reorder(ids: string[], userId: string) {
    const existing = await this.prisma.promptOption.findMany({
      where: { id: { in: ids } },
      select: { id: true, campaignId: true },
    });

    if (existing.length !== ids.length) {
      throw new BadRequestException('One or more prompt option IDs were not found');
    }
    const campaignIds = new Set(existing.map((o) => o.campaignId));
    if (campaignIds.size > 1) {
      throw new BadRequestException('All prompt options in a single reorder call must belong to the same campaign');
    }

    await Promise.all(
      ids.map((id, index) => this.prisma.promptOption.update({ where: { id }, data: { sortOrder: index } })),
    );

    const campaignId = [...campaignIds][0];
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'promptOption.reordered',
        entityType: 'promptOption',
        entityId: campaignId,
        metadata: { ids },
      },
    });

    return this.findAllByCampaign(campaignId, true);
  }
}
