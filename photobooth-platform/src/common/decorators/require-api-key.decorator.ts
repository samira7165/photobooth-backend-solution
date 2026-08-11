import { applyDecorators, UseGuards } from '@nestjs/common';
import { Public } from './public.decorator';
import { DeveloperApiKeyGuard } from '../guards/developer-api-key.guard';

// Composes @Public() (skips the global JwtAuthGuard — see jwt-auth.guard.ts)
// with DeveloperApiKeyGuard (enforces x-api-key instead), so a route needs
// only this one decorator to run under developer-key auth rather than JWT.
export const RequireApiKey = () => applyDecorators(Public(), UseGuards(DeveloperApiKeyGuard));
