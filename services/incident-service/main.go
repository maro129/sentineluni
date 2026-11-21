// INCIDENT SERVICE (Backend, Go): lógica de negocio de incidentes.
//   - Atiende REST desde el API Gateway (síncrono).
//   - Guarda en PostgreSQL (incidents_db) y publica IncidentCreated / IncidentStatusChanged
//     con el patrón Transactional Outbox (el evento se guarda en la misma transacción).
//   - Guarda la evidencia adjunta en Object Storage (MinIO / S3).
//   - Consume IncidentTriaged para actualizar la severidad en SUS propios datos.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"sentineluni/pkg/bus"
	"sentineluni/pkg/config"
	"sentineluni/pkg/httpx"
	"sentineluni/pkg/obs"
)

const service = "incident-service"

func main() {
	obs.Logger(service)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	shutdown := obs.InitTracing(ctx, service)
	defer shutdown(context.Background())

	store, err := NewStore(ctx, config.Env("DATABASE_URL", "postgres://sentinel:sentinel@localhost:5432/incidents_db"))
	if err != nil {
		slog.Error("no se pudo abrir PostgreSQL", "err", err)
		os.Exit(1)
	}
	b, err := bus.Connect(ctx, config.Env("NATS_URL", "nats://localhost:4222"), service)
	if err != nil {
		slog.Error("no se pudo conectar al Event Bus", "err", err)
		os.Exit(1)
	}
	defer b.Close()
	evidence := NewEvidenceStore(ctx)

	// Relay del outbox: publica en el bus los eventos guardados en la base.
	go store.RunOutboxRelay(ctx, b)

	// Reacciona a la clasificación hecha por Triage Service.
	if _, err := b.Subscribe(ctx, service, []string{bus.IncidentTriaged}, func(ctx context.Context, ev bus.Event) error {
		var d bus.IncidentTriagedData
		if err := ev.Decode(&d); err != nil {
			return nil // payload inválido: no tiene sentido reintentar
		}
		return store.ApplyTriage(ctx, d)
	}); err != nil {
		slog.Error("no se pudo suscribir", "err", err)
		os.Exit(1)
	}

	api := &API{store: store, evidence: evidence, bus: b}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", httpx.Health)
	mux.HandleFunc("GET /incidents", api.list)
	mux.HandleFunc("POST /incidents", api.create)
	mux.HandleFunc("GET /incidents/{id}", api.get)
	mux.HandleFunc("PATCH /incidents/{id}/status", api.changeStatus)
	mux.HandleFunc("GET /incidents/{id}/evidence", api.downloadEvidence)

	go func() {
		<-ctx.Done()
		time.Sleep(200 * time.Millisecond)
		os.Exit(0)
	}()
	if err := obs.Serve(":"+config.Env("PORT", "8080"), obs.Handler(service, mux)); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("servidor detenido", "err", err)
		os.Exit(1)
	}
}
