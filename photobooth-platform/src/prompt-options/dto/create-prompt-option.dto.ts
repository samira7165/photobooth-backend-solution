import { IsString, IsOptional, IsInt, IsBoolean, MinLength, MaxLength } from 'class-validator';
import { Type, Transform } from 'class-transformer';

// multipart/form-data (an optional "thumbnail" file rides alongside these
// fields — see PromptOptionsController.create), so every field below is
// transformed from its always-a-string wire form the same way
// UpdateAssetDto does for backgrounds/frames/props/templates.
export class CreatePromptOptionDto {
  @IsString()
  campaignId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  // The actual text sent to the AI provider — no length cap, same reasoning
  // as Template.prompt (create-template.dto.ts): real prompts routinely run
  // several thousand characters.
  @IsString()
  @MinLength(1)
  prompt: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' : value))
  @IsBoolean()
  isActive?: boolean;
}
