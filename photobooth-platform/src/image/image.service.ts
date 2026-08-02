import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs/promises';

@Injectable()
export class ImageService {
  private logger = new Logger(ImageService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  // ─── FULL POST-PROCESSING PIPELINE ───
  // Called after AI generation or as the non-AI pipeline

  async postProcess(
    imageBuffer: Buffer,
    options: {
      campaignId: string;
      campaignSlug: string;
      submissionId: string;
      backgroundId?: string;
      frameId?: string;
      propIds?: string[];
      orientation?: string;
      outputWidth?: number;
      outputHeight?: number;
      brandConfig?: any;
      textConfig?: any;
      qrConfig?: any;
    },
  ): Promise<{ resultBuffer: Buffer; mimeType: string }> {
    let currentImage = imageBuffer;
    const width = options.outputWidth || 1080;
    const height = options.outputHeight || 1920;

    this.logger.log(`Post-processing submission ${options.submissionId}: ${width}x${height}`);

    // Step 1: Resize to target dimensions
    currentImage = await this.resize(currentImage, width, height);
    this.logger.debug('Step 1: Resize complete');

    // Step 2: Apply frame overlay (if selected)
    if (options.frameId) {
      try {
        currentImage = await this.applyFrame(currentImage, options.frameId, width, height);
        this.logger.debug('Step 2: Frame overlay complete');
      } catch (err: any) {
        this.logger.warn(`Frame overlay failed: ${err.message}`);
      }
    }

    // Step 3: Apply props (if selected)
    if (options.propIds && options.propIds.length > 0) {
      try {
        currentImage = await this.applyProps(currentImage, options.propIds, width, height);
        this.logger.debug('Step 3: Props placement complete');
      } catch (err: any) {
        this.logger.warn(`Props placement failed: ${err.message}`);
      }
    }

    // Step 4: Apply logo/watermark (from brand config)
    if (options.brandConfig?.logo) {
      try {
        currentImage = await this.applyLogo(currentImage, options.brandConfig.logo, width, height);
        this.logger.debug('Step 4: Logo stamp complete');
      } catch (err: any) {
        this.logger.warn(`Logo stamp failed: ${err.message}`);
      }
    }

    // Step 5: Apply text overlay (if enabled)
    if (options.textConfig?.enabled && options.textConfig?.content) {
      try {
        currentImage = await this.applyText(currentImage, options.textConfig, width, height);
        this.logger.debug('Step 5: Text overlay complete');
      } catch (err: any) {
        this.logger.warn(`Text overlay failed: ${err.message}`);
      }
    }

    // Step 6: Final quality optimization
    currentImage = await sharp(currentImage)
      .png({ quality: 90, compressionLevel: 6 })
      .toBuffer();

    this.logger.log(`Post-processing complete: ${(currentImage.length / 1024).toFixed(0)}KB`);

    return { resultBuffer: currentImage, mimeType: 'image/png' };
  }

  // ─── NON-AI PIPELINE ───
  // For campaigns that don't use AI — just background removal + composite + decorations

  async processNonAI(
    userPhotoBuffer: Buffer,
    options: {
      campaignId: string;
      campaignSlug: string;
      submissionId: string;
      backgroundId?: string;
      frameId?: string;
      propIds?: string[];
      orientation?: string;
      outputWidth?: number;
      outputHeight?: number;
      brandConfig?: any;
      backgroundConfig?: any;
      textConfig?: any;
    },
  ): Promise<{ resultBuffer: Buffer; mimeType: string }> {
    const width = options.outputWidth || 1080;
    const height = options.outputHeight || 1920;
    let currentImage: Buffer;

    this.logger.log(`Non-AI processing submission ${options.submissionId}`);

    // Step 1: Remove background (if enabled)
    let personBuffer = userPhotoBuffer;
    if (options.backgroundConfig?.removal) {
      try {
        personBuffer = await this.removeBackground(userPhotoBuffer);
        this.logger.debug('Step 1: Background removal complete');
      } catch (err: any) {
        this.logger.warn(`Background removal failed, using original: ${err.message}`);
        personBuffer = userPhotoBuffer;
      }
    }

    // Step 2: Place on background
    if (options.backgroundId) {
      try {
        currentImage = await this.compositeOnBackground(personBuffer, options.backgroundId, width, height);
        this.logger.debug('Step 2: Background composite complete');
      } catch (err: any) {
        this.logger.warn(`Background composite failed: ${err.message}`);
        currentImage = await this.resize(personBuffer, width, height);
      }
    } else {
      // No background selected — just resize the photo
      currentImage = await this.resize(personBuffer, width, height);
    }

    // Step 3-6: Apply frame, props, logo, text (same as post-process)
    return this.postProcess(currentImage, options);
  }

  // ─── BACKGROUND REMOVAL ───

  async removeBackground(imageBuffer: Buffer): Promise<Buffer> {
    // Method 1: Use Sharp to remove white/solid backgrounds
    // This is a simple approach — for production, use rembg or a dedicated API

    // Simple approach: make white/near-white pixels transparent
    // For better results, integrate with rembg Python library or remove.bg API
    const { data, info } = await sharp(imageBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels = new Uint8Array(data);
    const threshold = 240; // near-white threshold

    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];

      // If pixel is near-white, make transparent
      if (r > threshold && g > threshold && b > threshold) {
        pixels[i + 3] = 0; // set alpha to 0
      }
    }

    return sharp(Buffer.from(pixels), {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png()
      .toBuffer();
  }

  // ─── COMPOSITE PERSON ON BACKGROUND ───

  async compositeOnBackground(
    personBuffer: Buffer,
    backgroundId: string,
    targetWidth: number,
    targetHeight: number,
  ): Promise<Buffer> {
    // Load the background image
    const background = await this.prisma.background.findUnique({ where: { id: backgroundId } });
    if (!background) throw new Error('Background not found');

    const bgBuffer = await this.loadAssetImage(background.imageUrl);

    // Resize background to target dimensions
    const resizedBg = await sharp(bgBuffer)
      .resize(targetWidth, targetHeight, { fit: 'cover' })
      .toBuffer();

    // Resize person to fit on background (80% of height, centered)
    const personHeight = Math.round(targetHeight * 0.8);
    const resizedPerson = await sharp(personBuffer)
      .resize({ height: personHeight, fit: 'inside', withoutEnlargement: true })
      .toBuffer();

    const personMeta = await sharp(resizedPerson).metadata();
    const personWidth = personMeta.width || 0;

    // Center the person on the background
    const left = Math.round((targetWidth - personWidth) / 2);
    const top = Math.round(targetHeight - personHeight - (targetHeight * 0.05)); // 5% from bottom

    // Composite
    return sharp(resizedBg)
      .composite([
        {
          input: resizedPerson,
          left: Math.max(0, left),
          top: Math.max(0, top),
        },
      ])
      .png()
      .toBuffer();
  }

  // ─── FRAME OVERLAY ───

  async applyFrame(
    imageBuffer: Buffer,
    frameId: string,
    targetWidth: number,
    targetHeight: number,
  ): Promise<Buffer> {
    const frame = await this.prisma.frame.findUnique({ where: { id: frameId } });
    if (!frame) throw new Error('Frame not found');

    const frameBuffer = await this.loadAssetImage(frame.imageUrl);

    // Resize frame to match image dimensions
    const resizedFrame = await sharp(frameBuffer)
      .resize(targetWidth, targetHeight, { fit: 'fill' })
      .png()
      .toBuffer();

    // Composite frame ON TOP of the image
    return sharp(imageBuffer)
      .composite([
        {
          input: resizedFrame,
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
  }

  // ─── PROPS PLACEMENT ───

  async applyProps(
    imageBuffer: Buffer,
    propIds: string[],
    targetWidth: number,
    targetHeight: number,
  ): Promise<Buffer> {
    let currentImage = imageBuffer;

    for (const propId of propIds) {
      const prop = await this.prisma.prop.findUnique({ where: { id: propId } });
      if (!prop) continue;

      const propBuffer = await this.loadAssetImage(prop.imageUrl);

      // Position based on prop type
      const position = this.getPropPosition(prop.positionType, targetWidth, targetHeight);

      // Resize prop to appropriate size
      const propSize = this.getPropSize(prop.positionType, targetWidth, targetHeight);
      const resizedProp = await sharp(propBuffer)
        .resize(propSize.width, propSize.height, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();

      // Composite prop onto image
      currentImage = await sharp(currentImage)
        .composite([
          {
            input: resizedProp,
            left: position.x,
            top: position.y,
          },
        ])
        .png()
        .toBuffer();
    }

    return currentImage;
  }

  private getPropPosition(positionType: string, width: number, height: number): { x: number; y: number } {
    switch (positionType) {
      case 'HEAD_TOP':
        return { x: Math.round(width * 0.3), y: Math.round(height * 0.02) };
      case 'FACE_EYES':
        return { x: Math.round(width * 0.25), y: Math.round(height * 0.15) };
      case 'FACE_FULL':
        return { x: Math.round(width * 0.2), y: Math.round(height * 0.1) };
      case 'HEAD_HAIR':
        return { x: Math.round(width * 0.25), y: Math.round(height * 0.01) };
      case 'BODY_NECK':
        return { x: Math.round(width * 0.3), y: Math.round(height * 0.3) };
      case 'HAND_HELD':
        return { x: Math.round(width * 0.05), y: Math.round(height * 0.5) };
      default:
        return { x: Math.round(width * 0.3), y: Math.round(height * 0.1) };
    }
  }

  private getPropSize(positionType: string, width: number, height: number): { width: number; height: number } {
    switch (positionType) {
      case 'HEAD_TOP':
        return { width: Math.round(width * 0.4), height: Math.round(height * 0.15) };
      case 'FACE_EYES':
        return { width: Math.round(width * 0.5), height: Math.round(height * 0.08) };
      case 'FACE_FULL':
        return { width: Math.round(width * 0.6), height: Math.round(height * 0.2) };
      case 'HEAD_HAIR':
        return { width: Math.round(width * 0.5), height: Math.round(height * 0.15) };
      case 'BODY_NECK':
        return { width: Math.round(width * 0.4), height: Math.round(height * 0.1) };
      case 'HAND_HELD':
        return { width: Math.round(width * 0.35), height: Math.round(height * 0.2) };
      default:
        return { width: Math.round(width * 0.4), height: Math.round(height * 0.15) };
    }
  }

  // ─── LOGO / WATERMARK STAMP ───

  async applyLogo(
    imageBuffer: Buffer,
    logoUrl: string,
    targetWidth: number,
    targetHeight: number,
  ): Promise<Buffer> {
    const logoBuffer = await this.loadAssetImage(logoUrl);

    // Resize logo to 15% of image width, bottom-right corner with 3% padding
    const logoWidth = Math.round(targetWidth * 0.15);
    const resizedLogo = await sharp(logoBuffer)
      .resize(logoWidth, null, { fit: 'inside' })
      .png()
      .toBuffer();

    const logoMeta = await sharp(resizedLogo).metadata();
    const logoHeight = logoMeta.height || 0;

    const padding = Math.round(targetWidth * 0.03);
    const left = Math.max(0, targetWidth - logoWidth - padding);
    const top = Math.max(0, targetHeight - logoHeight - padding);

    return sharp(imageBuffer)
      .composite([
        {
          input: resizedLogo,
          left,
          top,
        },
      ])
      .png()
      .toBuffer();
  }

  // ─── TEXT OVERLAY ───

  async applyText(
    imageBuffer: Buffer,
    textConfig: {
      content?: string;
      position?: { x: number; y: number };
      font?: string;
      color?: string;
      size?: number;
    },
    targetWidth: number,
    targetHeight: number,
  ): Promise<Buffer> {
    const color = textConfig.color || '#FFFFFF';
    const fontSize = textConfig.size || 32;
    const x = textConfig.position?.x ?? Math.round(targetWidth * 0.05);
    const y = textConfig.position?.y ?? Math.round(targetHeight * 0.92);

    // Create text as SVG overlay
    const svgText = `
      <svg width="${targetWidth}" height="${targetHeight}" xmlns="http://www.w3.org/2000/svg">
        <style>
          .text {
            fill: ${color};
            font-size: ${fontSize}px;
            font-family: Arial, Helvetica, sans-serif;
            font-weight: bold;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.8);
          }
        </style>
        <text x="${x}" y="${y}" class="text">${this.escapeXml(textConfig.content || '')}</text>
      </svg>
    `;

    return sharp(imageBuffer)
      .composite([
        {
          input: Buffer.from(svgText),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  // ─── RESIZE ───

  async resize(imageBuffer: Buffer, width: number, height: number): Promise<Buffer> {
    return sharp(imageBuffer)
      .resize(width, height, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();
  }

  // ─── THUMBNAIL GENERATION ───

  async generateThumbnail(imageBuffer: Buffer, maxWidth: number = 300): Promise<Buffer> {
    return sharp(imageBuffer)
      .resize(maxWidth, null, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();
  }

  // ─── ASSET LOADING ───
  // Backgrounds/frames/props/logos are stored the same way AssetsService saves
  // them: an S3 key in production, or a "/uploads/..." path in local dev
  // (see AssetsService.saveAssetFiles/deleteAssetFiles for the same routing).
  // A bare http(s) URL is also accepted since brandConfig.logo has no
  // dedicated upload flow and may be set to an external URL directly.

  private async loadAssetImage(imageUrl: string): Promise<Buffer> {
    if (/^https?:\/\//i.test(imageUrl)) {
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error(`Failed to fetch ${imageUrl}: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }

    if (imageUrl.startsWith('/uploads/')) {
      const filePath = path.join(process.cwd(), imageUrl.replace(/^\//, ''));
      return fs.readFile(filePath);
    }

    return this.storage.download(imageUrl);
  }
}
