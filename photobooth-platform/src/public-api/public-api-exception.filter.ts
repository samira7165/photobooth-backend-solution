import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';

// Reformats thrown exceptions into { success: false, error, timestamp } —
// scoped to PublicApiController only (@UseFilters there), so every other
// controller's existing error response shape is untouched.
@Catch()
export class PublicApiExceptionFilter implements ExceptionFilter {
  private logger = new Logger(PublicApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const error = this.extractMessage(exception);

    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }

    response.status(status).json({
      success: false,
      error,
      timestamp: new Date().toISOString(),
    });
  }

  private extractMessage(exception: unknown): string {
    if (!(exception instanceof HttpException)) return 'Internal server error';

    const body = exception.getResponse();
    if (typeof body === 'string') return body;
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = (body as { message: unknown }).message;
      return Array.isArray(message) ? message.join(', ') : String(message);
    }
    return exception.message;
  }
}
