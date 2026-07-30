import { PipeTransform, BadRequestException } from '@nestjs/common';
import { ZodSchema } from 'zod';

// Validates request body against a Zod schema
// Usage: new ZodValidationPipe(MyZodSchema) in controller method
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: any) {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));

      throw new BadRequestException({
        message: 'Validation failed',
        errors,
      });
    }

    return result.data;
  }
}
