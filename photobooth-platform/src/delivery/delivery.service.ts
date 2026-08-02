import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import * as QRCode from 'qrcode';
import sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs/promises';

@Injectable()
export class DeliveryService {
  private logger = new Logger(DeliveryService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  // ─── QR CODE GENERATION ───

  async generateQRCode(
    submissionId: string,
    campaignSlug: string,
    qrConfig?: {
      enabled?: boolean;
      position?: { x: number; y: number };
      size?: number;
      contentType?: string;
      customContent?: string;
    },
  ): Promise<{ qrCodeUrl: string; downloadUrl: string }> {
    if (qrConfig && qrConfig.enabled === false) {
      return { qrCodeUrl: '', downloadUrl: '' };
    }

    // Generate a short download code
    const downloadCode = this.generateShortCode();
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    const downloadUrl = `${baseUrl}/dl/${downloadCode}`;

    // Determine QR content
    let qrContent: string;
    if (qrConfig?.contentType === 'custom' && qrConfig?.customContent) {
      qrContent = qrConfig.customContent.replace('{downloadUrl}', downloadUrl).replace('{code}', downloadCode);
    } else {
      qrContent = downloadUrl;
    }

    // Generate QR code as PNG buffer
    const qrSize = qrConfig?.size || 300;
    const qrBuffer = await QRCode.toBuffer(qrContent, {
      type: 'png',
      width: qrSize,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'M',
    });

    // Save QR code
    let qrCodeUrl: string;
    const useS3 = this.storage.isConfigured();

    if (useS3) {
      qrCodeUrl = await this.storage.upload(
        qrBuffer,
        this.storage.getCampaignPath(campaignSlug, 'qrcodes'),
        `${submissionId}-qr.png`,
        'image/png',
      );
    } else {
      const qrDir = path.join(process.cwd(), 'uploads', 'campaigns', campaignSlug, 'qrcodes');
      await fs.mkdir(qrDir, { recursive: true });
      const filename = `${submissionId}-qr.png`;
      await fs.writeFile(path.join(qrDir, filename), qrBuffer);
      qrCodeUrl = `campaigns/${campaignSlug}/qrcodes/${filename}`;
    }

    // Save the download code in the database
    await this.prisma.submission.update({
      where: { id: submissionId },
      data: {
        qrCodeUrl,
        downloadCode,
      },
    });

    this.logger.log(`QR generated for ${submissionId}: code=${downloadCode}`);

    return { qrCodeUrl, downloadUrl };
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

  async getDownloadInfo(downloadCode: string) {
    const submission = await this.prisma.submission.findFirst({
      where: { downloadCode },
      select: {
        id: true,
        status: true,
        resultUrl: true,
        thumbnailUrl: true,
        userName: true,
        downloadCount: true,
        createdAt: true,
        campaign: {
          select: {
            name: true,
            slug: true,
            brandConfig: true,
            outputMode: true,
          },
        },
      },
    });

    if (!submission) {
      throw new NotFoundException('Download link not found or expired');
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

    // Increment download count
    await this.prisma.submission.update({
      where: { id: submission.id },
      data: { downloadCount: { increment: 1 } },
    });

    return {
      imageUrl,
      userName: submission.userName,
      campaignName: submission.campaign.name,
      branding: submission.campaign.brandConfig,
      downloadCount: submission.downloadCount + 1,
      createdAt: submission.createdAt,
    };
  }

  // ─── SHORT CODE GENERATOR ───

  private generateShortCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1 to avoid confusion
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}
