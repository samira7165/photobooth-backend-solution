import { Module, BadRequestException } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PromptOptionsService } from './prompt-options.service';
import { PromptOptionsController } from './prompt-options.controller';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Same Multer setup as AssetsModule — fileFilter rejects a bad thumbnail
// mimetype before it ever reaches the controller; size capped by
// MAX_FILE_SIZE (bytes) from .env, default 10MB. The thumbnail file itself
// is optional per-request (see PromptOptionsController), this just governs
// what's accepted when one is sent.
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
  controllers: [PromptOptionsController],
  providers: [PromptOptionsService],
  exports: [PromptOptionsService],
})
export class PromptOptionsModule {}
