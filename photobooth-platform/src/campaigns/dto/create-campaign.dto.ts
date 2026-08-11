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
