import { IsString, IsOptional, IsInt, IsArray, Min, MinLength } from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  providerId: string;

  // Human-readable label (e.g. "gemini-key-1") for admin UIs — never the
  // actual secret.
  @IsString()
  @MinLength(2)
  keyIdentifier: string;

  // The real API key, in plaintext here — AiProvidersService.createApiKey()
  // encrypts it (see common/utils/encryption.ts) before it's ever written to
  // the database.
  @IsString()
  @MinLength(10)
  apiKey: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  dailyLimit?: number;

  // Campaigns this key is restricted to. Omit/leave empty to make it a
  // shared/global key usable by any campaign — see createApiKey() in
  // ai-providers.service.ts for how that's represented.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  campaignIds?: string[];
}
