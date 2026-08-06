import { IsEmail, IsString, IsOptional, IsEnum, MaxLength, MinLength, Matches } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  // At least one lowercase, one uppercase, one digit — a light strength bar,
  // not a full policy (no special-char requirement, no dictionary check).
  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt silently truncates beyond 72 bytes
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number',
  })
  password: string;

  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
