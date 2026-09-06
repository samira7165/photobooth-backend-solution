import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// Connects to Redis on app start, disconnects on shutdown
@Injectable()
export class RedisService extends Redis implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(RedisService.name);

  constructor(private readonly configService: ConfigService) {
    super({
      host: configService.get<string>('REDIS_HOST', 'localhost'),
      port: parseInt(configService.get<string>('REDIS_PORT', '6379'), 10),
      password: configService.get<string>('REDIS_PASSWORD'),
      lazyConnect: true,
    });
  }

  async onModuleInit() {
    await this.connect();
    this.logger.log('Redis connected');
  }

  async onModuleDestroy() {
    this.disconnect();
    this.logger.log('Redis disconnected');
  }
}
