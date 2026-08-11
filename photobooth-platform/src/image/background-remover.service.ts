import { Injectable, Logger } from '@nestjs/common';

// The old removeBackground() (deleted from ImageService) made near-white
// pixels transparent via a fixed threshold — it broke on any non-white
// backdrop (dark rooms, stages, colorful sets, other people) and just as
// often ate white clothing/teeth/reflections on the subject. This uses
// @imgly/background-removal-node's real AI subject segmentation instead —
// runs locally (no API key, no per-call cost), downloading its ~50MB model
// once on first use and caching it after. There is deliberately no
// pixel-threshold fallback: a wrong "removal" that eats part of the person
// is worse than no removal at all, so any failure here just returns the
// original photo untouched.
@Injectable()
export class BackgroundRemoverService {
  private logger = new Logger(BackgroundRemoverService.name);

  // Always resolves — never throws. Callers can composite the result
  // directly onto a background without their own try/catch for this call.
  async removeBackground(imageBuffer: Buffer): Promise<Buffer> {
    try {
      // The package is ESM-only; this project compiles to CJS, so a dynamic
      // import() is required here rather than a static import.
      const { removeBackground } = await import('@imgly/background-removal-node');

      this.logger.log('Starting AI background removal...');

      const blob = new Blob([imageBuffer], { type: 'image/png' });

      const resultBlob = await removeBackground(blob, {
        debug: false,
        output: {
          format: 'image/png',
          quality: 0.9,
        },
      });

      const arrayBuffer = await resultBlob.arrayBuffer();
      const resultBuffer = Buffer.from(arrayBuffer);

      this.logger.log('Background removal complete');
      return resultBuffer;
    } catch (err: any) {
      this.logger.error(`Background removal failed: ${err.message} — using original photo`);
      return imageBuffer;
    }
  }
}
