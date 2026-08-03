import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProcessingWorker } from './processing.worker';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { PHOTO_PROCESSING_QUEUE } from '../queue/queue.service';

// ImageModule/WebsocketModule/PrismaModule/StorageModule are all @Global(),
// so only AiProvidersService and DeliveryService (neither global) need an
// explicit import here.
@Module({
  imports: [
    BullModule.registerQueue({ name: PHOTO_PROCESSING_QUEUE }),
    AiProvidersModule,
    DeliveryModule,
  ],
  providers: [ProcessingWorker],
})
export class ProcessingModule {}
