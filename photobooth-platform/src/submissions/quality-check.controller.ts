import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import sharp from 'sharp';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

// Debug endpoint for verifying a submission's photo quality wasn't lost
// somewhere in the pipeline (upload -> AI -> post-process -> saved output).
// No @Public() here, so the global JwtAuthGuard applies same as every other
// admin route in SubmissionsController; RolesGuard + @Roles() on top of that.
@Controller('quality')
export class QualityCheckController {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  @Get(':submissionId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async checkQuality(@Param('submissionId') submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
    });

    if (!submission) return { error: 'Submission not found' };

    const results: any = { submissionId };

    if (submission.originalUrl) {
      results.original = await this.describe(submission.originalUrl);
    }
    if (submission.resultUrl) {
      results.result = await this.describe(submission.resultUrl);
    }
    if (submission.thumbnailUrl) {
      results.thumbnail = await this.describe(submission.thumbnailUrl);
    }

    if (results.original && !results.original.error && results.result && !results.result.error) {
      const origPixels = (results.original.width || 0) * (results.original.height || 0);
      const resultPixels = (results.result.width || 0) * (results.result.height || 0);
      const ratio = origPixels > 0 ? resultPixels / origPixels : 0;

      results.verdict = {
        originalResolution: `${results.original.width}x${results.original.height}`,
        outputResolution: `${results.result.width}x${results.result.height}`,
        qualityPreserved: ratio > 0.5 ? 'GOOD' : 'DEGRADED',
        note:
          ratio > 0.5
            ? 'Output resolution is reasonable relative to input'
            : 'Significant resolution loss detected — check compression settings',
      };
    }

    return results;
  }

  // originalUrl/resultUrl/thumbnailUrl are never full http(s) URLs in this
  // codebase — StorageService.upload() returns a bare S3 key, and the local
  // fallback returns a bare relative path (see SubmissionsService.submitPhoto
  // and ProcessingWorker.saveOutput). Loading them has to branch on
  // storage.isConfigured(), the same way ProcessingWorker's own
  // loadOriginal/loadOutput do — a startsWith('http') check would just find
  // every field empty in any S3-configured (i.e. production) deployment,
  // which is exactly where this endpoint is most needed.
  private async loadBytes(key: string): Promise<Buffer> {
    if (this.storage.isConfigured()) {
      return this.storage.download(key);
    }
    return fs.readFile(path.join(process.cwd(), 'uploads', key));
  }

  private async describe(key: string) {
    try {
      const buffer = await this.loadBytes(key);
      const meta = await sharp(buffer).metadata();
      return {
        width: meta.width,
        height: meta.height,
        format: meta.format,
        sizeKB: Math.round(buffer.length / 1024),
        hasExifRotation: !!meta.orientation,
      };
    } catch (err: any) {
      return { error: err.message };
    }
  }
}
