import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { BackgroundRemoverService } from './background-remover.service';
import sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs/promises';

@Injectable()
export class ImageService {
  private logger = new Logger(ImageService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private backgroundRemoverService: BackgroundRemoverService,
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
      backgroundConfig?: any;
      textConfig?: any;
    },
  ): Promise<{ resultBuffer: Buffer; mimeType: string }> {
    const width = options.outputWidth || 1080;
    const height = options.outputHeight || 1920;
    let currentImage: Buffer;

    this.logger.log(`Non-AI processing submission ${options.submissionId}`);

    // Step 1: Remove background (if enabled for this campaign). No try/catch
    // needed here — BackgroundRemoverService.removeBackground() never
    // throws; it falls back to the original photo itself on any failure and
    // logs its own warning either way.
    let personBuffer = userPhotoBuffer;
    if (options.backgroundConfig?.removal) {
      personBuffer = await this.backgroundRemoverService.removeBackground(userPhotoBuffer);
      this.logger.debug('Step 1: Background removal complete');
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

    // Resize background to target dimensions — this one SHOULD fill the
    // entire canvas edge-to-edge, so 'cover' (crop to fill) is correct here,
    // unlike the person layer below.
    const resizedBg = await sharp(bgBuffer)
      .resize(targetWidth, targetHeight, { fit: 'cover' })
      .toBuffer();

    // No face/body detection here — instead of guessing a fixed 80%, size
    // relative to orientation and let 'inside' fit it without ever
    // cropping. Unlike 'contain', 'inside' doesn't pad out to a fixed box —
    // the result is exactly the cutout's own (possibly non-alpha-padded)
    // size, so left/top have to be computed explicitly below instead of
    // relying on contain's automatic centering.
    //
    // Deliberately using the TARGET CANVAS's orientation here, not the
    // cutout's own raw pixel dimensions — most webcam/phone captures come
    // back landscape-framed (e.g. 1080x720) even for a perfectly normal
    // upright headshot, so a cutout-dimensions check misclassifies that
    // extremely common case as "landscape person" and undersizes them
    // (confirmed live: a normal portrait headshot shot on a landscape
    // webcam came out tiny, sized to 80% of canvas *width* instead of 85%
    // of canvas *height*). The output canvas's own orientation (portrait
    // 1080x1920 vs. landscape 1920x1080) is fixed per campaign regardless
    // of how the capture device framed the shot, so it's the reliable
    // signal for which sizing rule actually applies.
    const isLandscapeCanvas = targetWidth > targetHeight;

    // withoutEnlargement deliberately omitted (defaults to false, allowing
    // upscale) — a typical webcam capture (e.g. 1080x720) is lower-res than
    // a full portrait output canvas (1080x1920), so hitting 85%/80% of the
    // canvas requires enlarging the cutout. withoutEnlargement:true was
    // tried first and confirmed live to silently cap the resize at the
    // source's original size, leaving the person a small ~37% of canvas
    // height instead of the intended 85% — a much worse defect than the
    // mild softness of a ~2x upscale.
    //
    // Both dimensions of the target box are passed (not just the one being
    // "aimed for") — passing only a height with width left unbounded lets
    // 'inside' scale width past the canvas's own width to preserve aspect
    // ratio, which sharp's compositing then hard-rejects ("Image to
    // composite must have same dimensions or smaller"), confirmed live.
    // Giving 'inside' the full box (targetWidth x personHeight, or
    // personWidth x targetHeight) makes it stop at whichever dimension is
    // actually the binding constraint, so the result can never exceed the
    // canvas on either axis.
    let resizedPerson: Buffer;
    if (isLandscapeCanvas) {
      const personWidth = Math.round(targetWidth * 0.8);
      resizedPerson = await sharp(personBuffer)
        .resize(personWidth, targetHeight, { fit: 'inside' })
        .toBuffer();
    } else {
      const personHeight = Math.round(targetHeight * 0.85);
      resizedPerson = await sharp(personBuffer)
        .resize(targetWidth, personHeight, { fit: 'inside' })
        .toBuffer();
    }

    const finalPersonMeta = await sharp(resizedPerson).metadata();
    const personWidth = finalPersonMeta.width || 0;
    const personHeight = finalPersonMeta.height || 0;

    // Center both horizontally and vertically. Bottom-aligning looked right
    // for a full-body photo, but for a headshot/bust-crop photo — which
    // can't reach the target height without exceeding canvas width (see the
    // no-crop comment above) — it left a small person stranded near the
    // bottom of a mostly-empty canvas. Centering is the one placement that
    // looks correct regardless of how large the resized person ends up.
    const left = Math.round((targetWidth - personWidth) / 2);
    const top = Math.round((targetHeight - personHeight) / 2);

    return sharp(resizedBg)
      .composite([
        {
          input: resizedPerson,
          left: Math.max(0, left),
          top,
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
  // Used for the FINAL output composition only — 'contain' fits the whole
  // image inside the target dimensions and pads any leftover space, so
  // nothing gets cut off. This matters most for AI-generated images, which
  // often come back 1:1 or landscape and were previously getting their
  // sides cropped off when forced into a portrait canvas via 'cover'.
  // Backgrounds (compositeOnBackground) are a different case — those SHOULD
  // fill the entire canvas edge-to-edge, so that resize keeps 'cover'.
  async resize(imageBuffer: Buffer, width: number, height: number): Promise<Buffer> {
    return sharp(imageBuffer)
      .resize(width, height, {
        fit: 'contain',
        position: 'centre',
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      })
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
  // Backgrounds/frames/props are stored the same way AssetsService saves
  // them: an S3 key in production, or a "/uploads/..." path in local dev
  // (see AssetsService.saveAssetFiles/deleteAssetFiles for the same routing).
  // A bare http(s) URL is also accepted for assets set directly to an
  // external URL.

  // Public: also called directly by ProcessingWorker to load a Template's
  // reference image ahead of an AI generation call.
  async loadAssetImage(imageUrl: string): Promise<Buffer> {
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
