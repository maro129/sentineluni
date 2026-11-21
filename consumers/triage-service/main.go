// TRIAGE SERVICE (Event Consumer, Go): clasifica la severidad de cada incidente nuevo.
// Consume IncidentCreated → aplica reglas → publica IncidentTriaged.
// No tiene API de negocio: solo reacciona a eventos (expone /health y /metrics internos).
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"sentineluni/pkg/bus"
	"sentineluni/pkg/config"
	"sentineluni/pkg/httpx"
	"sentineluni/pkg/obs"
)

const service = "triage-service"

func main() {
	obs.Logger(service)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	defer obs.InitTracing(ctx, service)(context.Background())

	b, err := bus.Connect(ctx, config.Env("NATS_URL", "nats://localhost:4222"), service)
	if err != nil {
		slog.Error("no se pudo conectar al Event Bus", "err", err)
		os.Exit(1)
	}
	defer b.Close()

	if _, err := b.Subscribe(ctx, service, []string{bus.IncidentCreated}, func(ctx context.Context, ev bus.Event) error {
		var d bus.IncidentCreatedData
		if err := ev.Decode(&d); err != nil {
			return nil
		}
		severity, reasons := Classify(d.Type, d.Title, d.Description, d.Asset)
		slog.Info("incidente clasificado", "incident", d.IncidentID, "severity", severity)
		out, err := b.NewEvent(bus.IncidentTriaged, bus.IncidentTriagedData{
			IncidentID: d.IncidentID, Title: d.Title, Type: d.Type, Severity: severity, Reasons: reasons,
		})
		if err != nil {
			return err
		}
		// ID derivado del evento de entrada: si este evento se reprocesa, JetStream y los
		// consumidores detectan el duplicado (idempotencia de punta a punta).
		out.ID = "triage-" + ev.ID
		return b.PublishEvent(ctx, out)
	}); err != nil {
		slog.Error("no se pudo suscribir", "err", err)
		os.Exit(1)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", httpx.Health)
	go func() { <-ctx.Done(); os.Exit(0) }()
	if err := obs.Serve(":"+config.Env("PORT", "8080"), obs.Handler(service, mux)); err != nil {
		slog.Error("servidor detenido", "err", err)
	}
}
