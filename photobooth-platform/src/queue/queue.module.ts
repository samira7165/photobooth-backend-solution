import { Module } from '@nestjs/common';
import { QueueController } from './queue.controller';

// QueueMonitorService (addJob/getQueueStats — the actual BullMQ producer) isn't
// built yet, so it's deliberately left out of providers here. QueueController
// only needs WebsocketGateway (global), which is enough for the /clients route.
@Module({
  controllers: [QueueController],
})
export class QueueMonitorModule {}
