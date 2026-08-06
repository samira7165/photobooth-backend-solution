import { Controller, Post, Body, Get, Request } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { Public } from '../common/decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // @Public() bypasses the global JwtAuthGuard — you need to be logged out
  // to call this. @Throttle overrides the global 100/min default (see
  // ThrottlerModule.forRoot in app.module.ts) with a much tighter limit
  // specifically here, since login is the one endpoint a brute-force
  // credential-stuffing attempt would actually hit.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 900000 } }) // max 5 attempts/15min per IP
  @Post('login')
  async login(@Body() body: LoginDto) {
    return this.authService.login(body.email, body.password);
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() body: RefreshTokenDto) {
    return this.authService.refreshToken(body.refreshToken);
  }

  // No @Public() here, so JwtAuthGuard requires a valid access token;
  // req.user is set by JwtStrategy.validate().
  @Get('profile')
  async getProfile(@Request() req) {
    return this.authService.getProfile(req.user.id);
  }
}
