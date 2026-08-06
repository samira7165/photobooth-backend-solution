import { IsOptional, IsString, IsDateString } from 'class-validator';

export class AnalyticsQueryDto {
  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  groupBy?: string; // "hour", "day", "campaign"
}
