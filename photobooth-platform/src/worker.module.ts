import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { ImageModule } from './image/image.module';
import { WebsocketModule } from './websocket/websocket.module';
import { ProcessingModule } from './processing/processing.module';

// A separate application context (no HTTP listener) that only pulls in what
// ProcessingWorker actually needs: PrismaService, StorageService, ImageService/
// BackgroundRemoverService, and WebsocketGateway. AiProvidersModule and
// DeliveryModule aren't imported directly here — ProcessingModule already
// imports both itself (see processing.module.ts), same as it does inside
// AppModule. PrismaModule/StorageModule/ImageModule/WebsocketModule are
// @Global(), but that only applies within the application context they're
// registered in — this is a distinct context from AppModule's, so each one
// still has to be imported here explicitly.
@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    StorageModule,
    ImageModule,
    WebsocketModule,
    // Same BullMQ Redis connection AppModule wires up, so this resolves jobs
    // against the exact same queue the API enqueues to.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: parseInt(config.get<string>('REDIS_PORT', '6379'), 10),
          password: config.get<string>('REDIS_PASSWORD'),
        },
      }),
    }),
    ProcessingModule,
  ],
})
export class WorkerModule {}
