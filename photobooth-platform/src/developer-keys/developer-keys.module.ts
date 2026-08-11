import { Module } from '@nestjs/common';
import { DeveloperKeysService } from './developer-keys.service';
import { DeveloperKeysController } from './developer-keys.controller';

@Module({
  controllers: [DeveloperKeysController],
  providers: [DeveloperKeysService],
  exports: [DeveloperKeysService],
})
export class DeveloperKeysModule {}
