import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

// @Global makes RedisService available to all modules without importing
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
