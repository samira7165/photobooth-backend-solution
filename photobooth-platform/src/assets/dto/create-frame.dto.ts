import { IsString, IsOptional, IsInt, IsBoolean, MinLength } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CreateFrameDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  campaignId: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' : value))
  @IsBoolean()
  isActive?: boolean;
}
