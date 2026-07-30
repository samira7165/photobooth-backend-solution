import { IsString, IsOptional, IsArray, MinLength } from 'class-validator';

export class CreateSubmissionDto {
  @IsOptional()
  @IsString()
  userName?: string;

  @IsOptional()
  @IsString()
  userEmail?: string;

  @IsOptional()
  @IsString()
  userPhone?: string;

  // Sent by the booth alongside the photo so it can be correlated with the
  // session created via POST booth/:campaignSlug/session. Declared here (not
  // pulled out with a second @Body('sessionId') param) so the global
  // ValidationPipe's whitelist doesn't reject it as an unrecognized field.
  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  backgroundId?: string;

  @IsOptional()
  @IsString()
  frameId?: string;

  @IsOptional()
  @IsArray()
  propIds?: string[];

  @IsOptional()
  @IsString()
  styleUsed?: string;

  @IsOptional()
  @IsString()
  orientation?: string; // "portrait" or "landscape"
}
