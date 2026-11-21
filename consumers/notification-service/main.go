// NOTIFICATION SERVICE (Event Consumer, Go): avisa al analista de incidentes graves.
// Consume IncidentTriaged (Alta/Crítica) e IncidentStatusChanged (Resuelto).
// Guarda en PostgreSQL (notifications_db) y, si está configurado, envía el aviso por Telegram.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"sentineluni/pkg/bus"
	"sentineluni/pkg/config"
	"sentineluni/pkg/httpx"
	"sentineluni/pkg/obs"
)

const service = "notification-service"

const schema = `
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,          -- = id del evento que la originó (idempotencia)
  incident_id TEXT NOT NULL,
  severity    TEXT NOT NULL,
  message     TEXT NOT NULL,
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications (created_at DESC);`

// Notification es un aviso para el analista.
type Notification struct {
	ID         string    `json:"id"`
	IncidentID string    `json:"incidentId"`
	Severity   string    `json:"severity"`
	Message    string    `json:"message"`
	Read       bool      `json:"read"`
	CreatedAt  time.Time `json:"createdAt"`
}

type app struct{ db *pgxpool.Pool }

func main() {
	obs.Logger(service)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	defer obs.InitTracing(ctx, service)(context.Background())

	db, err := connectDB(ctx, config.Env("DATABASE_URL", "postgres://sentinel:sentinel@localhost:5432/notifications_db"))
	if err != nil {
		slog.Error("no se pudo abrir PostgreSQL", "err", err)
		os.Exit(1)
	}
	a := &app{db: db}

	b, err := bus.Connect(ctx, config.Env("NATS_URL", "nats://localhost:4222"), service)
	if err != nil {
		slog.Error("no se pudo conectar al Event Bus", "err", err)
		os.Exit(1)
	}
	defer b.Close()

	if _, err := b.Subscribe(ctx, service, []string{bus.IncidentTriaged, bus.IncidentStatusChanged}, a.handle); err != nil {
		slog.Error("no se pudo suscribir", "err", err)
		os.Exit(1)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", httpx.Health)
	mux.HandleFunc("GET /notifications", httpx.RequireRole(a.list, "analyst", "admin"))
	mux.HandleFunc("PATCH /notifications/{id}/read", httpx.RequireRole(a.markRead, "analyst", "admin"))
	go func() { <-ctx.Done(); os.Exit(0) }()
	if err := obs.Serve(":"+config.Env("PORT", "8080"), obs.Handler(service, mux)); err != nil {
		slog.Error("servidor detenido", "err", err)
	}
}

func connectDB(ctx context.Context, url string) (*pgxpool.Pool, error) {
	var db *pgxpool.Pool
	var err error
	for i := 0; i < 30; i++ {
		if db, err = pgxpool.New(ctx, url); err == nil {
			if err = db.Ping(ctx); err == nil {
				_, err = db.Exec(ctx, schema)
				return db, err
			}
			db.Close()
		}
		slog.Warn("esperando a PostgreSQL", "err", err)
		time.Sleep(2 * time.Second)
	}
	return nil, err
}

func (a *app) handle(ctx context.Context, ev bus.Event) error {
	switch ev.Type {
	case bus.IncidentTriaged:
		var d bus.IncidentTriagedData
		if ev.Decode(&d) != nil {
			return nil
		}
		if d.Severity == "Alta" || d.Severity == "Crítica" {
			return a.notify(ctx, ev.ID, d.IncidentID, d.Severity,
				fmt.Sprintf("Incidente %s: %s (%s)", strings.ToUpper(d.Severity), d.Title, d.IncidentID))
		}
	case bus.IncidentStatusChanged:
		var d bus.IncidentStatusChangedData
		if ev.Decode(&d) != nil {
			return nil
		}
		if d.To == "Resuelto" {
			return a.notify(ctx, ev.ID, d.IncidentID, "Info", fmt.Sprintf("%s marcado como Resuelto por %s", d.IncidentID, d.By))
		}
	}
	return nil
}

// notify guarda el aviso una sola vez por evento (ON CONFLICT) y lo envía por el canal externo.
func (a *app) notify(ctx context.Context, eventID, incidentID, severity, message string) error {
	tag, err := a.db.Exec(ctx, `INSERT INTO notifications (id, incident_id, severity, message) VALUES ($1,$2,$3,$4)
		ON CONFLICT (id) DO NOTHING`, eventID, incidentID, severity, message)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return nil // evento repetido: ya se notificó
	}
	slog.Info("notificación creada", "incident", incidentID, "severity", severity)
	sendTelegram(ctx, message)
	return nil
}

// sendTelegram envía el aviso si TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID están definidos.
func sendTelegram(ctx context.Context, text string) {
	token, chat := os.Getenv("TELEGRAM_BOT_TOKEN"), os.Getenv("TELEGRAM_CHAT_ID")
	if token == "" || chat == "" {
		return
	}
	body, _ := json.Marshal(map[string]string{"chat_id": chat, "text": "🔔 SentinelUNI · " + text})
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+token+"/sendMessage", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		slog.Warn("Telegram no disponible", "err", err)
		return
	}
	resp.Body.Close()
}

func (a *app) list(w http.ResponseWriter, r *http.Request) {
	rows, err := a.db.Query(r.Context(), `SELECT id, incident_id, severity, message, read, created_at
		FROM notifications ORDER BY created_at DESC LIMIT 50`)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Error al listar notificaciones")
		return
	}
	defer rows.Close()
	out := []Notification{}
	for rows.Next() {
		var n Notification
		if err := rows.Scan(&n.ID, &n.IncidentID, &n.Severity, &n.Message, &n.Read, &n.CreatedAt); err == nil {
			out = append(out, n)
		}
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (a *app) markRead(w http.ResponseWriter, r *http.Request) {
	var n Notification
	err := a.db.QueryRow(r.Context(), `UPDATE notifications SET read = true WHERE id = $1
		RETURNING id, incident_id, severity, message, read, created_at`, r.PathValue("id")).
		Scan(&n.ID, &n.IncidentID, &n.Severity, &n.Message, &n.Read, &n.CreatedAt)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "Notificación no encontrada")
		return
	}
	httpx.JSON(w, http.StatusOK, n)
}
