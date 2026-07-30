import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { SubmissionsService } from './submissions.service';
import { SubmissionsController } from './submissions.controller';

@Module({
  imports: [
    MulterModule.register({
      limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 },
    }),
  ],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
