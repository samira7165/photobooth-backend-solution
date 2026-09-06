import { IsString, IsOptional, IsArray, IsEmail, MaxLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateSubmissionDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  userName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  userEmail?: string;

  @IsOptional()
  @Matches(/^[0-9+\-\s()]{7,20}$/, { message: 'Invalid phone number format' })
  userPhone?: string;

  // Sent by the booth alongside the photo so it can be correlated with the
  // session created via POST booth/:campaignSlug/session. Declared here (not
  // pulled out with a second @Body('sessionId') param) so the global
  // ValidationPipe's whitelist doesn't reject it as an unrecognized field.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  backgroundId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  frameId?: string;

  // Which AI reference-image/style Template the booth user picked (AI mode
  // only — ignored for non-AI submissions).
  @IsOptional()
  @IsString()
  @MaxLength(255)
  templateId?: string;

  // Which no-reference-image PromptOption the booth user picked instead of a
  // Template (AI mode only, campaigns with aiConfig.promptMode
  // "prompt-option"/"both" — see the PromptOption model comment in
  // schema.prisma). Mutually exclusive with templateId in practice, though
  // both stay independently optional here — SubmissionsService.submitPhoto
  // is what actually enforces which one a given campaign requires.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  promptOptionId?: string;

  // What the booth user typed for the campaign-level "Other" option
  // (aiConfig.customInput — see the field comment on Campaign.aiConfig in
  // schema.prisma). Mutually exclusive with promptOptionId — submitPhoto
  // rejects a request sending both. The DTO-level cap here is just a sane
  // outer bound; the real limit is the campaign's own configured
  // aiConfig.customInput.maxLength, enforced in SubmissionsService.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  customInput?: string;

  // multipart/form-data collapses a single repeated field down to a bare
  // string instead of a one-element array (multiple occurrences of the same
  // field name is what produces an array) — normalize before @IsArray() runs
  // so picking exactly one prop doesn't fail validation.
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? value : Array.isArray(value) ? value : [value]))
  @IsArray()
  @IsString({ each: true })
  propIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  styleUsed?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  orientation?: string; // "portrait" or "landscape"

  // Distinguishes a video-response booth (e.g. Dream Job) from the default
  // photo flow — see SubmissionsService.submitPhoto's isVideo branch. Only
  // 'video' has any effect; anything else (including omitted) is a photo.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  submissionType?: string;
}
