import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

/** Respuesta de error uniforme con el resto de servicios: { "error": "mensaje" }. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const msg = typeof body === 'string' ? body : (body as { message?: string | string[] }).message;
      res.status(exception.getStatus()).json({ error: Array.isArray(msg) ? msg.join('; ') : msg ?? exception.message });
      return;
    }
    Logger.error(exception, 'ErrorFilter');
    res.status(500).json({ error: 'Error interno' });
  }
}
