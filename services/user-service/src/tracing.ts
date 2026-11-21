// OpenTelemetry: trazas automáticas de HTTP, Express y PostgreSQL hacia el OTel Collector.
// Se carga antes que NestJS. Si OTEL_EXPORTER_OTLP_ENDPOINT no está definido, no hace nada.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  process.env.OTEL_SERVICE_NAME ??= 'user-service';
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } })],
  });
  sdk.start();
  process.on('SIGTERM', () => void sdk.shutdown());
}
