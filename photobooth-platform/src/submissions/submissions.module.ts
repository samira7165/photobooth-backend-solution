import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { SubmissionsService } from './submissions.service';
import { SubmissionsController } from './submissions.controller';
import { QueueMonitorModule } from '../queue/queue.module';

// No fileFilter here (unlike assets.module.ts) — mimetype is validated
// manually in SubmissionsService.submitPhoto() against ALLOWED_MIME_TYPES
// from .env instead, so the rejection message can be more specific.
@Module({
  imports: [
    MulterModule.register({
      limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 },
    }),
    QueueMonitorModule,
  ],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
