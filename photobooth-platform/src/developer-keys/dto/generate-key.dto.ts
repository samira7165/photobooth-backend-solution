import { IsString, IsOptional, IsIn, IsArray, IsInt, Min, IsDateString, MinLength, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class GenerateKeyDto {
  @IsString()
  campaignId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsIn(['live', 'test'])
  mode?: 'live' | 'test';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedOrigins?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rateLimit?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
