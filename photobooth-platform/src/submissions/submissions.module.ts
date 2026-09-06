import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { SubmissionsService } from './submissions.service';
import { SubmissionsController } from './submissions.controller';
import { QualityCheckController } from './quality-check.controller';
import { QueueMonitorModule } from '../queue/queue.module';
import { DeliveryModule } from '../delivery/delivery.module';

// No fileFilter here (unlike assets.module.ts) — mimetype is validated
// manually in SubmissionsService.submitPhoto() against ALLOWED_MIME_TYPES
// (photos) / ALLOWED_VIDEO_MIME_TYPES (video-booth submissions) from .env
// instead, so the rejection message can be more specific.
//
// Multer's fileSize limit is shared across both upload kinds since it's
// applied before the controller (and DTO's submissionType) is even reached
// — set to the larger of the two ceilings here, then submitPhoto enforces
// the tighter photo-specific limit itself so a plain photo upload doesn't
// silently inherit the bigger video allowance.
@Module({
  imports: [
    MulterModule.register({
      limits: {
        fileSize: Math.max(
          parseInt(process.env.MAX_FILE_SIZE) || 10485760,
          parseInt(process.env.MAX_VIDEO_FILE_SIZE) || 104857600,
        ),
      },
    }),
    QueueMonitorModule,
    DeliveryModule,
  ],
  controllers: [SubmissionsController, QualityCheckController],
  providers: [SubmissionsService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
