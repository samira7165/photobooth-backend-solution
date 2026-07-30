import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// Connects to Redis on app start, disconnects on shutdown
@Injectable()
export class RedisService extends Redis implements OnModuleInit, OnModuleDestroy {
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
    console.log('Redis connected');
  }

  async onModuleDestroy() {
    this.disconnect();
    console.log('Redis disconnected');
  }
}
