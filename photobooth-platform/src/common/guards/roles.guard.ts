import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

// Checks if user's role has sufficient permission
// Hierarchy: SUPER_ADMIN > ADMIN > OPERATOR > VIEWER
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No roles specified = allow access
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user) return false;

    // Role hierarchy — higher index = more permissions
    const hierarchy = ['VIEWER', 'OPERATOR', 'ADMIN', 'SUPER_ADMIN'];
    const userLevel = hierarchy.indexOf(user.role);

    // Check if user's role level is high enough for any required role
    return requiredRoles.some((role) => userLevel >= hierarchy.indexOf(role));
  }
}
