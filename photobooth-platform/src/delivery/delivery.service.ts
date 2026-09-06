import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import * as QRCode from 'qrcode';
import sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs/promises';

export interface QrCodeConfig {
  enabled?: boolean;
  position?: { x: number; y: number };
  size?: number;
  contentType?: string;
  customContent?: string;
  embedInImage?: boolean;
}
export interface ShortCodeConfig {
  enabled?: boolean;
  prefix?: string;
  codeLength?: number;
}
export interface DirectLinkConfig {
  enabled?: boolean;
  expiryHours?: number;
}
export interface PrintDeliveryConfig {
  enabled?: boolean;
  format?: string;
  copies?: number;
}
export interface DeliveryConfig {
  qrCode?: QrCodeConfig;
  shortCode?: ShortCodeConfig;
  directLink?: DirectLinkConfig;
  print?: PrintDeliveryConfig;
}
export type ResolvedDeliveryConfig = {
  qrCode: QrCodeConfig;
  shortCode: ShortCodeConfig;
  directLink: DirectLinkConfig;
  print: PrintDeliveryConfig;
};

@Injectable()
export class DeliveryService {
  private logger = new Logger(DeliveryService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  // ─── CONFIG RESOLUTION ───

  // Normalizes a campaign's delivery settings into the current multi-method
  // shape, whether it has the new deliveryConfig or only the legacy
  // single-purpose qrConfig (every campaign created before deliveryConfig
  // existed). Exported so CampaignsService.getBoothConfig can expose the
  // same resolved shape the booth actually gets driven by, rather than the
  // raw possibly-legacy DB value.
  resolveDeliveryConfig(campaign: { deliveryConfig?: unknown; qrConfig?: unknown }): ResolvedDeliveryConfig {
    if (campaign.deliveryConfig) {
      const dc = campaign.deliveryConfig as DeliveryConfig;
      return {
        qrCode: dc.qrCode ?? {},
        shortCode: dc.shortCode ?? { enabled: true },
        directLink: dc.directLink ?? {},
        print: dc.print ?? {},
      };
    }

    // Legacy fallback: downloadCode was always generated as a side effect of
    // QR generation, gated only by qrConfig.enabled — there was no
    // independent shortCode/directLink toggle before deliveryConfig existed,
    // so this reproduces that exact behavior instead of silently turning
    // shortCode "on" for every old campaign regardless of qrConfig.enabled.
    const legacyQr = (campaign.qrConfig as QrCodeConfig) ?? {};
    const legacyEnabled = legacyQr.enabled !== false;
    return {
      qrCode: legacyQr,
      shortCode: { enabled: legacyEnabled },
      directLink: { enabled: false },
      print: { enabled: false },
    };
  }

  // ─── DELIVERY GENERATION (QR + short code + direct link) ───

  // Always generates the raw downloadCode + displayCode together (the
  // lookup key regardless of which methods are enabled — shortCode and
  // directLink both point at the same code, just presented differently) and
  // only renders the actual QR image when qrCode.enabled. Returns early
  // with nothing generated only if every method is explicitly disabled.
  async generateDelivery(
    submissionId: string,
    campaign: { slug: string; deliveryConfig?: unknown; qrConfig?: unknown },
  ): Promise<{ downloadCode: string | null; displayCode: string | null; qrCodeUrl: string; downloadUrl: string }> {
    const config = this.resolveDeliveryConfig(campaign);
    const anyMethodEnabled =
      config.qrCode?.enabled !== false || config.shortCode?.enabled !== false || config.directLink?.enabled !== false;

    if (!anyMethodEnabled) {
      return { downloadCode: null, displayCode: null, qrCodeUrl: '', downloadUrl: '' };
    }

    const downloadCode = this.generateShortCode(config.shortCode?.codeLength);
    const prefix = this.normalizePrefix(config.shortCode?.prefix);
    const displayCode = prefix ? `${prefix}-${downloadCode}` : downloadCode;

    // ADMIN_URL (not FRONTEND_URL) is the actual running app — the
    // admin-dashboard's own /dl/[code] page, which is the guest-facing page
    // this link/QR code needs to open. FRONTEND_URL has no server behind it.
    const baseUrl = process.env.ADMIN_URL || 'http://localhost:3002';
    const downloadUrl = `${baseUrl}/dl/${downloadCode}`;

    let qrCodeUrl = '';
    if (config.qrCode?.enabled !== false) {
      let qrContent: string;
      if (config.qrCode?.contentType === 'custom' && config.qrCode?.customContent) {
        qrContent = config.qrCode.customContent.replace('{downloadUrl}', downloadUrl).replace('{code}', downloadCode);
      } else {
        qrContent = downloadUrl;
      }

      const qrSize = config.qrCode?.size || 300;
      const qrBuffer = await QRCode.toBuffer(qrContent, {
        type: 'png',
        width: qrSize,
        margin: 2,
        color: { dark: '#000000', light: '#FFFFFF' },
        errorCorrectionLevel: 'M',
      });

      const useS3 = this.storage.isConfigured();
      if (useS3) {
        qrCodeUrl = await this.storage.upload(
          qrBuffer,
          this.storage.getCampaignPath(campaign.slug, 'qrcodes'),
          `${submissionId}-qr.png`,
          'image/png',
        );
      } else {
        const qrDir = path.join(process.cwd(), 'uploads', 'campaigns', campaign.slug, 'qrcodes');
        await fs.mkdir(qrDir, { recursive: true });
        const filename = `${submissionId}-qr.png`;
        await fs.writeFile(path.join(qrDir, filename), qrBuffer);
        qrCodeUrl = `campaigns/${campaign.slug}/qrcodes/${filename}`;
      }
    }

    const expiryHours = config.directLink?.expiryHours;
    const downloadCodeExpiresAt = expiryHours ? new Date(Date.now() + expiryHours * 60 * 60 * 1000) : null;

    await this.prisma.submission.update({
      where: { id: submissionId },
      data: { qrCodeUrl: qrCodeUrl || null, downloadCode, displayCode, downloadCodeExpiresAt },
    });

    this.logger.log(
      `Delivery generated for ${submissionId}: code=${downloadCode}` +
        (prefix ? ` (display: ${displayCode})` : '') +
        (qrCodeUrl ? ', QR rendered' : ', QR skipped') +
        (downloadCodeExpiresAt ? `, expires ${downloadCodeExpiresAt.toISOString()}` : ''),
    );

    return { downloadCode, displayCode, qrCodeUrl, downloadUrl };
  }

  // ─── EMBED QR CODE INTO IMAGE ───

  async embedQRInImage(
    imageBuffer: Buffer,
    qrBuffer: Buffer,
    qrConfig: {
      position?: { x: number; y: number };
      size?: number;
    },
    imageWidth: number,
    imageHeight: number,
  ): Promise<Buffer> {
    const qrSize = qrConfig?.size || 150;
    const defaultX = imageWidth - qrSize - Math.round(imageWidth * 0.03);
    const defaultY = imageHeight - qrSize - Math.round(imageHeight * 0.03);
    const x = qrConfig?.position?.x ?? defaultX;
    const y = qrConfig?.position?.y ?? defaultY;

    // Resize QR to specified size
    const resizedQR = await sharp(qrBuffer)
      .resize(qrSize, qrSize)
      .png()
      .toBuffer();

    // Add a white background padding around QR for scanability
    const paddedSize = qrSize + 10;
    const paddedQR = await sharp({
      create: {
        width: paddedSize,
        height: paddedSize,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 230 },
      },
    })
      .composite([
        {
          input: resizedQR,
          left: 5,
          top: 5,
        },
      ])
      .png()
      .toBuffer();

    // Composite QR onto image
    return sharp(imageBuffer)
      .composite([
        {
          input: paddedQR,
          left: Math.max(0, x),
          top: Math.max(0, y),
        },
      ])
      .png()
      .toBuffer();
  }

  // ─── DOWNLOAD HANDLING ───

  // countAsDownload defaults true for the actual image-serving route; the
  // guest-facing page calls this too (just to render a preview + button),
  // and without opting out here every page view would inflate downloadCount
  // before the guest has downloaded anything.
  async getDownloadInfo(code: string, options: { countAsDownload?: boolean } = {}) {
    const countAsDownload = options.countAsDownload !== false;

    // A guest might type/scan either "DREAM-4K7X" (with the campaign's
    // shortCode prefix) or just "4K7X" — downloadCode in the DB is always
    // stored without a prefix (see generateDelivery above), so strip
    // everything up to the last hyphen before looking up. A code with no
    // hyphen at all (no prefix configured, or a guest omits it) passes
    // through unchanged.
    const cleanCode = code.includes('-') ? code.split('-').pop()! : code;

    const submission = await this.prisma.submission.findFirst({
      where: { downloadCode: cleanCode },
      select: {
        id: true,
        status: true,
        resultUrl: true,
        thumbnailUrl: true,
        userName: true,
        downloadCount: true,
        createdAt: true,
        displayCode: true,
        downloadCodeExpiresAt: true,
        campaign: {
          select: {
            name: true,
            slug: true,
            outputMode: true,
          },
        },
      },
    });

    if (!submission) {
      throw new NotFoundException('Download link not found or expired');
    }

    // Only meaningful for campaigns with deliveryConfig.directLink.expiryHours
    // set — every submission before this feature existed has
    // downloadCodeExpiresAt null and never expires, exactly as before.
    if (submission.downloadCodeExpiresAt && submission.downloadCodeExpiresAt < new Date()) {
      throw new NotFoundException('This download link has expired');
    }

    if (submission.status !== 'COMPLETED') {
      throw new NotFoundException('Photo is not ready yet');
    }

    // Generate download URL
    let imageUrl: string;
    const useS3 = this.storage.isConfigured();

    if (useS3 && submission.resultUrl) {
      // Generate presigned URL with 24 hour expiry
      imageUrl = await this.storage.getPresignedUrl(submission.resultUrl, 86400);
    } else {
      imageUrl = `/uploads/${submission.resultUrl}`;
    }

    if (countAsDownload) {
      await this.prisma.submission.update({
        where: { id: submission.id },
        data: { downloadCount: { increment: 1 } },
      });
    }

    return {
      imageUrl,
      userName: submission.userName,
      campaignName: submission.campaign.name,
      displayCode: submission.displayCode,
      downloadCount: countAsDownload ? submission.downloadCount + 1 : submission.downloadCount,
      createdAt: submission.createdAt,
    };
  }

  // ─── SHORT CODE GENERATOR ───

  private generateShortCode(length?: number): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 to avoid confusion
    const len = Math.min(8, Math.max(4, length || 6)); // clamp to the same 4-8 range CampaignsService validates on save
    let code = '';
    for (let i = 0; i < len; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // Defensive re-normalization at generation time (uppercase, alphanumeric
  // only, max 10 chars) — CampaignsService already validates this on
  // save, but a campaign's deliveryConfig can only be trusted as far as
  // whatever wrote it; this guarantees a malformed/manually-edited prefix
  // can never end up in a real displayCode.
  private normalizePrefix(prefix?: string): string {
    if (!prefix) return '';
    return prefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  }
}
