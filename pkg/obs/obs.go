// Package obs agrupa la observabilidad común: logs JSON, métricas Prometheus y trazas OpenTelemetry.
package obs

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

var (
	httpRequests = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sentinel_http_requests_total", Help: "Peticiones HTTP atendidas",
	}, []string{"service", "method", "route", "code"})
	httpDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name: "sentinel_http_request_duration_seconds", Help: "Duración de las peticiones HTTP",
		Buckets: prometheus.DefBuckets,
	}, []string{"service", "method", "route"})
	// EventsPublished cuenta los eventos publicados en el Event Bus.
	EventsPublished = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sentinel_events_published_total", Help: "Eventos publicados en el Event Bus",
	}, []string{"service", "type"})
	// EventsProcessed cuenta los eventos consumidos (result = ok | error).
	EventsProcessed = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "sentinel_events_processed_total", Help: "Eventos consumidos del Event Bus",
	}, []string{"service", "type", "result"})
)

// Logger crea un logger JSON con el nombre del servicio y lo deja como logger por defecto.
func Logger(service string) *slog.Logger {
	l := slog.New(slog.NewJSONHandler(os.Stdout, nil)).With("service", service)
	slog.SetDefault(l)
	return l
}

// InitTracing configura OpenTelemetry. Si OTEL_EXPORTER_OTLP_ENDPOINT no está definido,
// las trazas quedan desactivadas (no-op) para que el servicio funcione igual en local.
func InitTracing(ctx context.Context, service string) func(context.Context) error {
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	if os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT") == "" {
		return func(context.Context) error { return nil }
	}
	exp, err := otlptracehttp.New(ctx)
	if err != nil {
		slog.Warn("no se pudo iniciar el exportador OTLP", "err", err)
		return func(context.Context) error { return nil }
	}
	res, _ := resource.Merge(resource.Default(), resource.NewWithAttributes(semconv.SchemaURL, semconv.ServiceName(service)))
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exp), sdktrace.WithResource(res))
	otel.SetTracerProvider(tp)
	return tp.Shutdown
}

type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (r *statusRecorder) WriteHeader(code int) { r.code = code; r.ResponseWriter.WriteHeader(code) }

// Handler envuelve el mux con trazas (otelhttp), métricas por ruta y expone /metrics.
func Handler(service string, mux *http.ServeMux) http.Handler {
	mux.Handle("GET /metrics", promhttp.Handler())
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, code: http.StatusOK}
		mux.ServeHTTP(rec, r)
		route := r.Pattern // patrón de ServeMux (Go 1.23), evita cardinalidad por IDs
		if route == "" {
			route = "unmatched"
		}
		httpRequests.WithLabelValues(service, r.Method, route, strconv.Itoa(rec.code)).Inc()
		httpDuration.WithLabelValues(service, r.Method, route).Observe(time.Since(start).Seconds())
	})
	return otelhttp.NewHandler(inner, service,
		otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string { return r.Method + " " + r.URL.Path }),
		otelhttp.WithFilter(func(r *http.Request) bool { return r.URL.Path != "/metrics" && r.URL.Path != "/health" }))
}

// Serve arranca un servidor HTTP con timeouts razonables.
func Serve(addr string, h http.Handler) error {
	srv := &http.Server{Addr: addr, Handler: h, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second}
	slog.Info("escuchando", "addr", addr)
	return srv.ListenAndServe()
}
