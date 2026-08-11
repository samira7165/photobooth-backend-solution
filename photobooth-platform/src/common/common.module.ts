import { Global, Module } from '@nestjs/common';
import { CorsService } from './services/cors.service';

// @Global so any feature module (CampaignsModule, main.ts's app.get(), etc.)
// can use CorsService without importing this module directly — same pattern
// as PrismaModule.
@Global()
@Module({
  providers: [CorsService],
  exports: [CorsService],
})
export class CommonModule {}
