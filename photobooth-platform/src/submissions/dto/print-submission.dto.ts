import { IsString, IsOptional, MaxLength } from 'class-validator';

export class PrintSubmissionDto {
  // Optional identifier of which booth/printer sent this — not enforced or
  // validated against a known-printers list, since this codebase has no
  // printer/booth registry to check it against.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  printerId?: string;
}
