import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;

  const REAL_PASSWORD = 'CorrectHorseBattery123';
  let realPasswordHash: string;

  const mockUser = {
    id: 'user-1',
    email: 'admin@xri.com.bd',
    name: 'Admin',
    role: 'SUPER_ADMIN',
    isActive: true,
    passwordHash: '',
  };

  const mockPrisma = {
    user: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
  };

  const mockJwtService = {
    signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
    verify: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        JWT_SECRET: 'test-jwt-secret',
        JWT_REFRESH_SECRET: 'test-jwt-refresh-secret',
        JWT_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
      };
      return values[key];
    }),
  };

  beforeAll(async () => {
    // Uses real bcrypt so the test actually exercises AuthService's
    // comparison logic, not a mocked stand-in for it.
    realPasswordHash = await bcrypt.hash(REAL_PASSWORD, 12);
    mockUser.passwordHash = realPasswordHash;
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('login', () => {
    it('rejects a correct email with the wrong password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      await expect(service.login(mockUser.email, 'wrong-password')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a non-existent email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.login('nobody@example.com', REAL_PASSWORD)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a deactivated user even with the correct password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, isActive: false });
      await expect(service.login(mockUser.email, REAL_PASSWORD)).rejects.toThrow(UnauthorizedException);
    });

    it('logs in with the correct password and returns tokens + user, and records an audit log entry', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.login(mockUser.email, REAL_PASSWORD);

      expect(result.user).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        role: mockUser.role,
      });
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toBe('signed.jwt.token');
      expect(mockJwtService.signAsync).toHaveBeenCalledTimes(2);
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: mockUser.id, action: 'user.login' }),
        }),
      );
    });

    it('signs the access and refresh tokens with different secrets', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      await service.login(mockUser.email, REAL_PASSWORD);

      const [accessCallOpts] = mockJwtService.signAsync.mock.calls[0];
      const [, accessSignOpts] = mockJwtService.signAsync.mock.calls[0];
      const [, refreshSignOpts] = mockJwtService.signAsync.mock.calls[1];

      expect(accessCallOpts).toEqual({ sub: mockUser.id, email: mockUser.email, role: mockUser.role });
      expect(accessSignOpts.secret).toBe('test-jwt-secret');
      expect(refreshSignOpts.secret).toBe('test-jwt-refresh-secret');
    });
  });

  describe('refreshToken', () => {
    it('rejects an invalid/unverifiable refresh token', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });
      await expect(service.refreshToken('garbage')).rejects.toThrow(ForbiddenException);
    });

    it('rejects a refresh token for a user that no longer exists', async () => {
      mockJwtService.verify.mockReturnValue({ sub: 'ghost-user' });
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.refreshToken('valid-looking-token')).rejects.toThrow(ForbiddenException);
    });

    it('rejects a refresh token for a deactivated user', async () => {
      mockJwtService.verify.mockReturnValue({ sub: mockUser.id });
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, isActive: false });
      await expect(service.refreshToken('valid-looking-token')).rejects.toThrow(ForbiddenException);
    });

    it('issues a new token pair for a valid refresh token', async () => {
      mockJwtService.verify.mockReturnValue({ sub: mockUser.id });
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.refreshToken('valid-looking-token');

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toBe('signed.jwt.token');
    });
  });
});
