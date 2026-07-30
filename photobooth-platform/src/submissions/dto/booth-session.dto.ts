import { IsString, IsOptional, MinLength } from 'class-validator';

export class CreateBoothSessionDto {
  @IsString()
  @MinLength(1)
  campaignSlug: string;

  @IsOptional()
  @IsString()
  hallId?: string; // optional hall identifier
}
