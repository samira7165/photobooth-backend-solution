import { Test, TestingModule } from '@nestjs/testing';
import { AiProvidersService } from './ai-providers.service';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, decrypt } from '../common/utils/encryption';

// getKey() in encryption.ts derives its key from ENCRYPTION_SECRET (falling
// back to JWT_SECRET) read at call time — set a fixed test value so these
// tests don't depend on whatever happens to be in the shell environment.
process.env.ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET || 'jest-test-only-encryption-secret-not-real';

describe('encryption round-trip', () => {
  it('decrypts back to the original plaintext', () => {
    const plaintext = 'sk-super-secret-api-key-abc123';
    const encrypted = encrypt(plaintext);

    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('produces a different ciphertext each time (random IV) but both decrypt correctly', () => {
    const plaintext = 'same-key-encrypted-twice';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);

    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it('throws if the ciphertext has been tampered with', () => {
    const encrypted = encrypt('tamper-test');
    const [iv, authTag, ciphertext] = encrypted.split(':');
    const tampered = [iv, authTag, ciphertext.slice(0, -2) + '00'].join(':');

    expect(() => decrypt(tampered)).toThrow();
  });
});

describe('AiProvidersService — key selection', () => {
  let service: AiProvidersService;

  const mockPrisma = {
    campaignApiKey: { findMany: jest.fn() },
    apiKey: { update: jest.fn(), findUnique: jest.fn() },
  };

  const makeKey = (apiKeyOverrides: Record<string, any> = {}) => ({
    apiKey: {
      id: 'key-1',
      providerId: 'provider-1',
      encryptedKey: encrypt('real-secret-value'),
      isActive: true,
      dailyLimit: null,
      usageToday: 0,
      errorCount: 0,
      provider: { id: 'provider-1', name: 'gemini', isHealthy: true },
      ...apiKeyOverrides,
    },
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiProvidersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AiProvidersService>(AiProvidersService);
  });

  it('skips inactive keys', async () => {
    mockPrisma.campaignApiKey.findMany.mockResolvedValue([
      makeKey({ id: 'inactive', isActive: false }),
    ]);

    const result = await service.getAvailableKey('campaign-1');
    expect(result).toBeNull();
  });

  it('skips keys whose provider is unhealthy', async () => {
    mockPrisma.campaignApiKey.findMany.mockResolvedValue([
      makeKey({ id: 'unhealthy-provider', provider: { id: 'p1', name: 'gemini', isHealthy: false } }),
    ]);

    const result = await service.getAvailableKey('campaign-1');
    expect(result).toBeNull();
  });

  it('skips keys that have hit their daily limit', async () => {
    mockPrisma.campaignApiKey.findMany.mockResolvedValue([
      makeKey({ id: 'over-limit', dailyLimit: 100, usageToday: 100 }),
    ]);

    const result = await service.getAvailableKey('campaign-1');
    expect(result).toBeNull();
  });

  it('skips keys with 10 or more consecutive errors', async () => {
    mockPrisma.campaignApiKey.findMany.mockResolvedValue([
      makeKey({ id: 'erroring', errorCount: 10 }),
    ]);

    const result = await service.getAvailableKey('campaign-1');
    expect(result).toBeNull();
  });

  it('picks a key under its daily limit over one that has hit it, and decrypts it', async () => {
    mockPrisma.campaignApiKey.findMany.mockResolvedValue([
      makeKey({ id: 'over-limit', dailyLimit: 10, usageToday: 10 }),
      makeKey({ id: 'under-limit', dailyLimit: 10, usageToday: 3 }),
    ]);

    const result = await service.getAvailableKey('campaign-1');
    expect(result?.keyId).toBe('under-limit');
    expect(result?.key).toBe('real-secret-value');
  });

  it('prefers the key with fewer errors, then fewer usageToday, among otherwise-eligible keys', async () => {
    mockPrisma.campaignApiKey.findMany.mockResolvedValue([
      makeKey({ id: 'more-errors', errorCount: 3, usageToday: 0 }),
      makeKey({ id: 'fewer-errors-more-usage', errorCount: 0, usageToday: 50 }),
      makeKey({ id: 'fewer-errors-less-usage', errorCount: 0, usageToday: 5 }),
    ]);

    const result = await service.getAvailableKey('campaign-1');
    expect(result?.keyId).toBe('fewer-errors-less-usage');
  });

  it('filters by provider name when one is specified', async () => {
    mockPrisma.campaignApiKey.findMany.mockResolvedValue([
      makeKey({ id: 'gemini-key', provider: { id: 'p1', name: 'gemini', isHealthy: true } }),
      makeKey({ id: 'dalle-key', provider: { id: 'p2', name: 'dalle', isHealthy: true } }),
    ]);

    const result = await service.getAvailableKey('campaign-1', 'dalle');
    expect(result?.keyId).toBe('dalle-key');
    expect(result?.providerName).toBe('dalle');
  });
});
