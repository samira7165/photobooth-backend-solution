import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Usage: @CurrentUser() user in controller methods — gets the logged-in user from JWT
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
