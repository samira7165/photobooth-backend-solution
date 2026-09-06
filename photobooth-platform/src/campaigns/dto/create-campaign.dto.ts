import { IsString, IsOptional, IsObject, IsArray, IsInt, IsNumber, IsDateString, MinLength, MaxLength } from 'class-validator';

export class CreateCampaignDto {
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @IsString()
  @MinLength(2)
  @MaxLength(255)
  slug: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  processingMode?: string; // "ai", "non-ai", "both"

  @IsOptional()
  @IsObject()
  aiConfig?: {
    provider?: string;
    model?: string;
    prompt?: string;
    strength?: number;
    fallbackProviders?: string[];
    keyChain?: string[]; // ordered ApiKeyModel ids: [primary, fallback1, fallback2, ...]
    allowCustomPrompt?: boolean;
    referenceImage?: string;
    aiBackgroundGeneration?: boolean;
    aiBackgroundPrompt?: string;
  };

  @IsOptional()
  @IsObject()
  photoSettings?: {
    orientation?: string;
    outputWidth?: number;
    outputHeight?: number;
  };

  @IsOptional()
  @IsObject()
  backgroundConfig?: {
    removal?: boolean;
    allowCustomUpload?: boolean;
    defaultBackgroundId?: string;
  };

  @IsOptional()
  @IsObject()
  frameConfig?: {
    enabled?: boolean;
    defaultFrameId?: string;
  };

  @IsOptional()
  @IsObject()
  propConfig?: {
    enabled?: boolean;
  };

  @IsOptional()
  @IsObject()
  qrConfig?: {
    enabled?: boolean;
    position?: { x: number; y: number };
    size?: number;
    contentType?: string;
    customContent?: string;
  };

  // Superset of qrConfig above — see the field comment on the Campaign model
  // in schema.prisma. The specific business rules (prefix format, codeLength
  // range, expiryHours range) are enforced in CampaignsService, not here —
  // same shallow-@IsObject() convention every other JSON config field above
  // already uses; class-validator's nested-object support isn't worth
  // fighting for one deeply-optional field.
  @IsOptional()
  @IsObject()
  deliveryConfig?: {
    qrCode?: { enabled?: boolean; position?: { x: number; y: number }; size?: number; contentType?: string; customContent?: string; embedInImage?: boolean };
    shortCode?: { enabled?: boolean; prefix?: string; codeLength?: number };
    directLink?: { enabled?: boolean; expiryHours?: number };
    print?: { enabled?: boolean; format?: string; copies?: number };
  };

  @IsOptional()
  @IsObject()
  textConfig?: {
    enabled?: boolean;
    content?: string;
    position?: { x: number; y: number };
    font?: string;
    color?: string;
    size?: number;
    allowCustomText?: boolean;
  };

  @IsOptional()
  @IsArray()
  collectFields?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(20)
  outputMode?: string; // "qr", "download", "print", "sms", "email"

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsInt()
  maxSubmissions?: number;

  @IsOptional()
  @IsNumber()
  dailyBudget?: number;

  @IsOptional()
  @IsNumber()
  totalBudget?: number;
}
