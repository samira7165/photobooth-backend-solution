import { IsString, IsOptional, IsArray, IsEmail, MaxLength, Matches } from 'class-validator';

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

  @IsOptional()
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
}
