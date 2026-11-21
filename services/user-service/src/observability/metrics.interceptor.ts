import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { httpDuration, httpRequests, logins } from './metrics';

/** Cuenta peticiones y latencia por ruta (patrón, no URL) para Prometheus. */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const route = (req.route?.path as string | undefined) ?? 'unmatched';
    const end = httpDuration.startTimer({ method: req.method, route });
    const done = (code: number) => {
      end();
      httpRequests.inc({ method: req.method, route, code: String(code) });
      if (route === '/auth/login') logins.inc({ result: code === 200 ? 'ok' : 'fail' });
    };
    return next.handle().pipe(
      tap({
        next: () => done(ctx.switchToHttp().getResponse<Response>().statusCode),
        error: (e: unknown) => done(e instanceof HttpException ? e.getStatus() : 500),
      }),
    );
  }
}
