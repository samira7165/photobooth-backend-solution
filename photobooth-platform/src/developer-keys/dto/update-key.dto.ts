import { IsString, IsOptional, IsArray, IsBoolean, IsInt, Min, MinLength, MaxLength } from 'class-validator';

export class UpdateKeyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedOrigins?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  rateLimit?: number;
}
