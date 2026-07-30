import { IsString, MinLength } from 'class-validator';

export class CreateProviderDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsString()
  @MinLength(4)
  baseUrl: string;
}
