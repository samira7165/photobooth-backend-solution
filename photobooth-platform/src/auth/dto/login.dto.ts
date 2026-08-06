import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  // Deliberately no strength @Matches here — this is a login, not account
  // creation, so it just needs to bound the payload size, not enforce a
  // policy on a password that was already set.
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}
