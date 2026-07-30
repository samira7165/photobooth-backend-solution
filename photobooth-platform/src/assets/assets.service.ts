import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ImageOptimizer } from '../common/utils/image-optimizer';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

type AssetKind = 'backgrounds' | 'frames' | 'props';

interface AssetCreateInput {
  campaignId: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
  positionType?: string;
}

interface AssetUpdateInput {
  name?: string;
  sortOrder?: number;
  isActive?: boolean;
  positionType?: string;
}

// Backgrounds, frames, and props are three separate Prisma models but share
// an identical CRUD shape (create/list/get/update/replace-image/delete/reorder).
// Rather than tripling that logic, the "shared CRUD core" section below does
// the real work parameterized by AssetKind, and the per-type sections at the
// bottom (BACKGROUNDS/FRAMES/PROPS) are thin wrappers with the specific
// method names the controller calls.
@Injectable()
export class AssetsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  // ─── shared file helpers ───

  private sanitizeName(name: string) {
    return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  }

  // Builds the thumbnail once, format-aware so PNGs (frames/props) keep transparency
  // instead of being flattened to JPEG.
  private async makeThumbnail(buffer: Buffer, thumbExt: 'png' | 'jpg') {
    return thumbExt === 'png'
      ? sharp(buffer).resize({ width: 200 }).png({ quality: 70 }).toBuffer()
      : sharp(buffer).resize({ width: 200 }).jpeg({ quality: 70 }).toBuffer();
  }

  private async saveAssetFiles(campaign: { id: string; slug: string }, kind: AssetKind, file: Express.Multer.File) {
    const validation = await ImageOptimizer.validateImage(file.buffer);
    if (!validation.valid) {
      throw new BadRequestException('Uploaded file is not a valid image');
    }

    const ext = MIME_EXT[file.mimetype] || 'jpg';
    const thumbExt: 'png' | 'jpg' = ext === 'png' ? 'png' : 'jpg';
    const thumbContentType = thumbExt === 'png' ? 'image/png' : 'image/jpeg';
    const thumbBuffer = await this.makeThumbnail(file.buffer, thumbExt);

    if (this.storage.isConfigured()) {
      // Production: upload the original and its thumbnail to S3, store the S3 keys.
      const imageKey = await this.storage.upload(
        file.buffer,
        this.storage.getCampaignPath(campaign.slug, kind),
        file.originalname,
        file.mimetype,
      );
      const thumbnailKey = imageKey.replace(`/${kind}/`, '/thumbnails/');
      await this.storage.uploadWithKey(thumbBuffer, thumbnailKey, thumbContentType);

      return { imageUrl: imageKey, thumbnailUrl: thumbnailKey };
    }

    // Development fallback: no AWS credentials configured, save to local disk instead.
    const uid = randomUUID();
    const safeName = this.sanitizeName(file.originalname);
    const filename = `${uid}-${safeName}`;
    const thumbFilename = `${uid}-thumb.${thumbExt}`;

    const assetDir = path.join(UPLOAD_ROOT, 'campaigns', campaign.id, kind);
    const thumbDir = path.join(UPLOAD_ROOT, 'campaigns', campaign.id, 'thumbnails');
    await fs.mkdir(assetDir, { recursive: true });
    await fs.mkdir(thumbDir, { recursive: true });

    await fs.writeFile(path.join(assetDir, filename), file.buffer);
    await fs.writeFile(path.join(thumbDir, thumbFilename), thumbBuffer);

    return {
      imageUrl: `/uploads/campaigns/${campaign.id}/${kind}/${filename}`,
      thumbnailUrl: `/uploads/campaigns/${campaign.id}/thumbnails/${thumbFilename}`,
    };
  }

  // Local paths always start with "/uploads/" (see saveAssetFiles above); anything else
  // is an S3 key. Routing on the URL shape — rather than re-checking isConfigured() here —
  // means a file still gets deleted from the right place even if AWS credentials were
  // added or removed after it was originally uploaded.
  private async deleteAssetFiles(imageUrl?: string | null, thumbnailUrl?: string | null) {
    for (const url of [imageUrl, thumbnailUrl]) {
      if (!url) continue;
      if (url.startsWith('/uploads/')) {
        const filePath = path.join(process.cwd(), url.replace(/^\//, ''));
        await fs.unlink(filePath).catch(() => undefined);
      } else {
        await this.storage.delete(url);
      }
    }
  }

  private async getCampaignOrThrow(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  // Returns the Prisma model delegate for the given asset kind, so the shared
  // CRUD methods below can call e.g. delegate.create(...) generically. Typed
  // `any` because Background/Frame/Prop have slightly different shapes
  // (positionType only exists on Prop).
  private getDelegate(kind: AssetKind): any {
    switch (kind) {
      case 'backgrounds':
        return this.prisma.background;
      case 'frames':
        return this.prisma.frame;
      case 'props':
        return this.prisma.prop;
    }
  }

  private entityType(kind: AssetKind) {
    return kind.slice(0, -1); // backgrounds -> background, frames -> frame, props -> prop
  }

  // ─── shared CRUD core ───

  private async createAsset(
    kind: AssetKind,
    dto: AssetCreateInput,
    file: Express.Multer.File,
    userId: string,
  ) {
    const campaign = await this.getCampaignOrThrow(dto.campaignId);
    const { imageUrl, thumbnailUrl } = await this.saveAssetFiles(campaign, kind, file);

    const data: any = {
      campaignId: dto.campaignId,
      name: dto.name,
      imageUrl,
      thumbnailUrl,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    };
    if (kind === 'props' && dto.positionType) {
      data.positionType = dto.positionType;
    }

    const created = await this.getDelegate(kind).create({ data });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: `${this.entityType(kind)}.created`,
        entityType: this.entityType(kind),
        entityId: created.id,
        metadata: { campaignId: dto.campaignId, name: dto.name },
      },
    });

    return created;
  }

  private async findAllByCampaign(kind: AssetKind, campaignId: string, includeInactive = false) {
    return this.getDelegate(kind).findMany({
      where: includeInactive ? { campaignId } : { campaignId, isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  private async findAssetById(kind: AssetKind, id: string) {
    const asset = await this.getDelegate(kind).findUnique({ where: { id } });
    if (!asset) throw new NotFoundException(`${this.entityType(kind)} not found`);
    return asset;
  }

  private async updateAsset(kind: AssetKind, id: string, dto: AssetUpdateInput, userId: string) {
    await this.findAssetById(kind, id);

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (kind === 'props' && dto.positionType !== undefined) data.positionType = dto.positionType;

    const updated = await this.getDelegate(kind).update({ where: { id }, data });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: `${this.entityType(kind)}.updated`,
        entityType: this.entityType(kind),
        entityId: id,
        metadata: { changes: Object.keys(data) },
      },
    });

    return updated;
  }

  private async updateAssetImage(kind: AssetKind, id: string, file: Express.Multer.File, userId: string) {
    const existing = await this.findAssetById(kind, id);
    const campaign = await this.getCampaignOrThrow(existing.campaignId);
    const { imageUrl, thumbnailUrl } = await this.saveAssetFiles(campaign, kind, file);

    const updated = await this.getDelegate(kind).update({
      where: { id },
      data: { imageUrl, thumbnailUrl },
    });

    await this.deleteAssetFiles(existing.imageUrl, existing.thumbnailUrl);

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: `${this.entityType(kind)}.image_replaced`,
        entityType: this.entityType(kind),
        entityId: id,
      },
    });

    return updated;
  }

  private async deleteAsset(kind: AssetKind, id: string, userId: string) {
    const existing = await this.findAssetById(kind, id);

    await this.getDelegate(kind).delete({ where: { id } });
    await this.deleteAssetFiles(existing.imageUrl, existing.thumbnailUrl);

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: `${this.entityType(kind)}.deleted`,
        entityType: this.entityType(kind),
        entityId: id,
        metadata: { name: existing.name },
      },
    });

    return { message: `${this.entityType(kind)} deleted successfully` };
  }

  private async reorderAssets(kind: AssetKind, campaignId: string, orderedIds: string[], userId: string) {
    const delegate = this.getDelegate(kind);
    const existing: { id: string }[] = await delegate.findMany({
      where: { campaignId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((e) => e.id));

    if (
      !Array.isArray(orderedIds) ||
      orderedIds.length !== existingIds.size ||
      !orderedIds.every((id) => existingIds.has(id))
    ) {
      throw new BadRequestException('orderedIds must contain exactly the asset IDs belonging to this campaign');
    }

    await Promise.all(
      orderedIds.map((id, index) => delegate.update({ where: { id }, data: { sortOrder: index } })),
    );

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: `${this.entityType(kind)}.reordered`,
        entityType: this.entityType(kind),
        entityId: campaignId,
        metadata: { orderedIds },
      },
    });

    return this.findAllByCampaign(kind, campaignId, true);
  }

  // ─── BACKGROUNDS ───

  createBackground(dto: AssetCreateInput, file: Express.Multer.File, userId: string) {
    return this.createAsset('backgrounds', dto, file, userId);
  }
  findAllBackgrounds(campaignId: string, includeInactive = false) {
    return this.findAllByCampaign('backgrounds', campaignId, includeInactive);
  }
  findBackgroundById(id: string) {
    return this.findAssetById('backgrounds', id);
  }
  updateBackground(id: string, dto: AssetUpdateInput, userId: string) {
    return this.updateAsset('backgrounds', id, dto, userId);
  }
  updateBackgroundImage(id: string, file: Express.Multer.File, userId: string) {
    return this.updateAssetImage('backgrounds', id, file, userId);
  }
  deleteBackground(id: string, userId: string) {
    return this.deleteAsset('backgrounds', id, userId);
  }
  reorderBackgrounds(campaignId: string, orderedIds: string[], userId: string) {
    return this.reorderAssets('backgrounds', campaignId, orderedIds, userId);
  }

  // ─── FRAMES ───

  createFrame(dto: AssetCreateInput, file: Express.Multer.File, userId: string) {
    return this.createAsset('frames', dto, file, userId);
  }
  findAllFrames(campaignId: string, includeInactive = false) {
    return this.findAllByCampaign('frames', campaignId, includeInactive);
  }
  findFrameById(id: string) {
    return this.findAssetById('frames', id);
  }
  updateFrame(id: string, dto: AssetUpdateInput, userId: string) {
    return this.updateAsset('frames', id, dto, userId);
  }
  updateFrameImage(id: string, file: Express.Multer.File, userId: string) {
    return this.updateAssetImage('frames', id, file, userId);
  }
  deleteFrame(id: string, userId: string) {
    return this.deleteAsset('frames', id, userId);
  }
  reorderFrames(campaignId: string, orderedIds: string[], userId: string) {
    return this.reorderAssets('frames', campaignId, orderedIds, userId);
  }

  // ─── PROPS ───

  createProp(dto: AssetCreateInput, file: Express.Multer.File, userId: string) {
    return this.createAsset('props', dto, file, userId);
  }
  findAllProps(campaignId: string, includeInactive = false) {
    return this.findAllByCampaign('props', campaignId, includeInactive);
  }
  findPropById(id: string) {
    return this.findAssetById('props', id);
  }
  updateProp(id: string, dto: AssetUpdateInput, userId: string) {
    return this.updateAsset('props', id, dto, userId);
  }
  updatePropImage(id: string, file: Express.Multer.File, userId: string) {
    return this.updateAssetImage('props', id, file, userId);
  }
  deleteProp(id: string, userId: string) {
    return this.deleteAsset('props', id, userId);
  }
  reorderProps(campaignId: string, orderedIds: string[], userId: string) {
    return this.reorderAssets('props', campaignId, orderedIds, userId);
  }
}
