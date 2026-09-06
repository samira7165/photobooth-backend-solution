import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

// Standalone entry point for the BullMQ queue consumer — no HTTP listener,
// just the DI context ProcessingWorker needs. Runs the same job-processing
// code as when it's loaded in-process via AppModule (src/main.ts); this just
// lets it be deployed/scaled as its own process (see Dockerfile.worker).
async function bootstrap() {
  const logger = new Logger('Worker');
  await NestFactory.createApplicationContext(WorkerModule);
  logger.log('Worker process started — listening for BullMQ jobs');
}

bootstrap();
