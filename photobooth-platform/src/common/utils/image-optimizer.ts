import sharp from 'sharp';

// All image processing utilities — resize, thumbnail, validation
export class ImageOptimizer {
  // Resize and compress photo before sending to AI (saves 30-50% on tokens)
  static async optimize(
    inputBuffer: Buffer,
    maxSize: number = 1024,
  ): Promise<Buffer> {
    return sharp(inputBuffer)
      .resize(maxSize, maxSize, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer();
  }

  // Resize for specific AI provider (different providers work best at different sizes)
  static async optimizeForProvider(
    inputBuffer: Buffer,
    provider: string,
  ): Promise<Buffer> {
    const maxSize: Record<string, number> = {
      gemini: 1024,
      dalle: 1024,
      replicate: 768,
    };

    const size = maxSize[provider] || 1024;
    return this.optimize(inputBuffer, size);
  }

  // Generate small thumbnail for admin dashboard previews
  static async makeThumbnail(inputBuffer: Buffer): Promise<Buffer> {
    return sharp(inputBuffer)
      .resize(300, 300, { fit: 'cover' })
      .jpeg({ quality: 70 })
      .toBuffer();
  }

  // Resize to specific orientation
  static async resizeToOrientation(
    inputBuffer: Buffer,
    orientation: 'portrait' | 'landscape',
    width: number = 1080,
    height: number = 1920,
  ): Promise<Buffer> {
    const w = orientation === 'portrait' ? width : height;
    const h = orientation === 'portrait' ? height : width;

    return sharp(inputBuffer)
      .resize(w, h, { fit: 'cover' })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  // Validate that a file is actually an image (checks magic bytes, not just extension)
  static async validateImage(inputBuffer: Buffer): Promise<{
    valid: boolean;
    format: string;
    width: number;
    height: number;
    sizeKB: number;
  }> {
    try {
      const metadata = await sharp(inputBuffer).metadata();

      const allowedFormats = ['jpeg', 'png', 'webp'];
      const isAllowed = allowedFormats.includes(metadata.format || '');

      return {
        valid: isAllowed,
        format: metadata.format || 'unknown',
        width: metadata.width || 0,
        height: metadata.height || 0,
        sizeKB: Math.round(inputBuffer.length / 1024),
      };
    } catch {
      return {
        valid: false,
        format: 'invalid',
        width: 0,
        height: 0,
        sizeKB: 0,
      };
    }
  }

  // Composite one image on top of another (used for frames, overlays, backgrounds)
  static async composite(
    baseBuffer: Buffer,
    overlayBuffer: Buffer,
    options?: { left?: number; top?: number; opacity?: number },
  ): Promise<Buffer> {
    const overlay = options?.opacity
      ? await sharp(overlayBuffer)
          .ensureAlpha(options.opacity)
          .toBuffer()
      : overlayBuffer;

    return sharp(baseBuffer)
      .composite([
        {
          input: overlay,
          left: options?.left || 0,
          top: options?.top || 0,
        },
      ])
      .toBuffer();
  }
}
