import { IsString, IsOptional, MinLength } from 'class-validator';

// Not currently used — SubmissionsController.createSession() takes
// campaignSlug from the URL param and reads hallId off a plain inline body
// type instead. Kept here for a future version of that endpoint that wants
// full DTO validation.
export class CreateBoothSessionDto {
  @IsString()
  @MinLength(1)
  campaignSlug: string;

  @IsOptional()
  @IsString()
  hallId?: string; // optional hall identifier
}
