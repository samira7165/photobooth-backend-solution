import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

// Usage: @Roles('ADMIN', 'SUPER_ADMIN') on controller methods
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
