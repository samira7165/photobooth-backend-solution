import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

// Catches all errors and returns clean JSON response
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errors = undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exResponse = exception.getResponse();

      if (typeof exResponse === 'string') {
        message = exResponse;
      } else if (typeof exResponse === 'object') {
        message = (exResponse as any).message || message;
        errors = (exResponse as any).errors;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      console.error('Unhandled error:', exception.stack);
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      error: message,
      ...(errors && { errors }),
    });
  }
}
