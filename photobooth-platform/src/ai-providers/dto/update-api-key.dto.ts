import { IsString, IsOptional, IsInt, IsBoolean, Min, MinLength } from 'class-validator';

export class UpdateApiKeyDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  keyIdentifier?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // A key's own getAvailableKey() filter is `usageToday < dailyLimit` — a
  // limit of 0 (or negative) would never be greater than usageToday, so the
  // key would silently and permanently look "at limit" from the moment it's
  // saved. Nothing in the UI would explain why the key stopped being
  // selected, so this is enforced here rather than left to the caller.
  @IsOptional()
  @IsInt()
  @Min(1)
  dailyLimit?: number;
}
