import { IsString, IsOptional, IsInt, IsArray, MinLength } from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  providerId: string;

  @IsString()
  @MinLength(2)
  keyIdentifier: string;

  @IsString()
  @MinLength(4)
  apiKey: string;

  @IsOptional()
  @IsInt()
  dailyLimit?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  campaignIds?: string[];
}
