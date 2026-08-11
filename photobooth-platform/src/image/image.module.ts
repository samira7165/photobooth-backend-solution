import { Module, Global } from '@nestjs/common';
import { ImageService } from './image.service';
import { BackgroundRemoverService } from './background-remover.service';

// @Global() so ImageService is available anywhere (e.g. the future processing
// worker) without importing ImageModule directly. PrismaService and
// StorageService are @Global() too, so no imports are needed here.
@Global()
@Module({
  providers: [ImageService, BackgroundRemoverService],
  exports: [ImageService, BackgroundRemoverService],
})
export class ImageModule {}
