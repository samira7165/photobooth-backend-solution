import { Module, BadRequestException } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// fileFilter runs before the file ever reaches a controller/service, so bad
// uploads (wrong mimetype) are rejected as early as possible; file size is
// capped by MAX_FILE_SIZE (bytes) from .env, default 10MB.
@Module({
  imports: [
    MulterModule.register({
      limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 },
      fileFilter: (req, file, callback) => {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          return callback(new BadRequestException('Only JPEG, PNG, and WEBP images are allowed'), false);
        }
        callback(null, true);
      },
    }),
  ],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
