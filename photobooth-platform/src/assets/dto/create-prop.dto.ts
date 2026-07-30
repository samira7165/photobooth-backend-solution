import { IsString, IsOptional, IsInt, IsBoolean, IsEnum, MinLength } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CreatePropDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  campaignId: string;

  @IsOptional()
  @IsEnum(['HEAD_TOP', 'FACE_EYES', 'FACE_FULL', 'HEAD_HAIR', 'BODY_NECK', 'HAND_HELD'])
  positionType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' : value))
  @IsBoolean()
  isActive?: boolean;
}
