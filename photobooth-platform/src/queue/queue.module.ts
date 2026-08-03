import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueController } from './queue.controller';
import { QueueMonitorService, PHOTO_PROCESSING_QUEUE } from './queue.service';

@Module({
  imports: [BullModule.registerQueue({ name: PHOTO_PROCESSING_QUEUE })],
  controllers: [QueueController],
  providers: [QueueMonitorService],
  exports: [QueueMonitorService],
})
export class QueueMonitorModule {}
