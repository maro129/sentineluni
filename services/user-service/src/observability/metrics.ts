import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

export const registry = new Registry();
registry.setDefaultLabels({ service: 'user-service' });
collectDefaultMetrics({ register: registry });

export const httpRequests = new Counter({
  name: 'sentinel_http_requests_total', help: 'Peticiones HTTP atendidas',
  labelNames: ['method', 'route', 'code'], registers: [registry],
});
export const httpDuration = new Histogram({
  name: 'sentinel_http_request_duration_seconds', help: 'Duración de las peticiones HTTP',
  labelNames: ['method', 'route'], registers: [registry],
});
export const logins = new Counter({
  name: 'sentinel_logins_total', help: 'Intentos de login', labelNames: ['result'], registers: [registry],
});
