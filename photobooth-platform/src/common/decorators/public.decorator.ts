import { SetMetadata } from '@nestjs/common';

// Usage: @Public() on controller methods that don't need authentication
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
