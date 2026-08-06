import { IsString, MinLength } from 'class-validator';

export class AddApiKeyModelDto {
  // e.g. "gemini-2.5-flash-image" — one of possibly several models this
  // key's provider account can call.
  @IsString()
  @MinLength(1)
  model: string;
}
