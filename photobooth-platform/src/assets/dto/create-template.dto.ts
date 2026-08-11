import { IsString, IsOptional, IsInt, IsBoolean, MinLength } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CreateTemplateDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  campaignId: string;

  // e.g. "Turn this person into Spider-Man in the classic red-and-blue suit,
  // web-slinging pose" — overrides the campaign's aiConfig.prompt for
  // submissions that pick this template. Leave blank to just use the
  // campaign default prompt for this template too. No length cap, same as
  // the campaign's own aiConfig.prompt — detailed face-swap/style prompts
  // routinely run several thousand characters, and Gemini handles far more
  // than that.
  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' : value))
  @IsBoolean()
  isActive?: boolean;
}
