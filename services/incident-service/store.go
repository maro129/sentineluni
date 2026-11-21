package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"

	"sentineluni/pkg/bus"
)

// Incident es un incidente de seguridad.
type Incident struct {
	ID            string    `json:"id"`
	Title         string    `json:"title"`
	Type          string    `json:"type"`
	Description   string    `json:"description"`
	Asset         string    `json:"asset"`
	Status        string    `json:"status"`
	Severity      string    `json:"severity"`
	TriageReasons []string  `json:"triageReasons"`
	ReportedBy    string    `json:"reportedBy"`
	EvidenceName  *string   `json:"evidenceName,omitempty"`
	EvidenceKey   *string   `json:"-"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

const schema = `
CREATE TABLE IF NOT EXISTS incidents (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  type           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  asset          TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL,
  severity       TEXT NOT NULL,
  triage_reasons JSONB NOT NULL DEFAULT '[]',
  reported_by    TEXT NOT NULL,
  evidence_key   TEXT,
  evidence_name  TEXT,
  created_at     TIMESTAMPTZ NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS incidents_created_idx ON incidents (created_at DESC);
CREATE TABLE IF NOT EXISTS outbox (
  id           TEXT PRIMARY KEY,
  event        JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS trace JSONB NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox (created_at) WHERE published_at IS NULL;`

const cols = `id, title, type, description, asset, status, severity, triage_reasons, reported_by, evidence_key, evidence_name, created_at, updated_at`

// Store accede a incidents_db.
type Store struct{ db *pgxpool.Pool }

// NewStore abre el pool (reintentando hasta que PostgreSQL esté listo) y crea el esquema.
func NewStore(ctx context.Context, url string) (*Store, error) {
	var db *pgxpool.Pool
	var err error
	for i := 0; i < 30; i++ {
		if db, err = pgxpool.New(ctx, url); err == nil {
			if err = db.Ping(ctx); err == nil {
				break
			}
			db.Close()
		}
		slog.Warn("esperando a PostgreSQL", "err", err)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(ctx, schema); err != nil {
		return nil, fmt.Errorf("crear esquema: %w", err)
	}
	return &Store{db: db}, nil
}

func scan(row pgx.Row) (Incident, error) {
	var i Incident
	var reasons []byte
	err := row.Scan(&i.ID, &i.Title, &i.Type, &i.Description, &i.Asset, &i.Status, &i.Severity, &reasons,
		&i.ReportedBy, &i.EvidenceKey, &i.EvidenceName, &i.CreatedAt, &i.UpdatedAt)
	if err == nil {
		_ = json.Unmarshal(reasons, &i.TriageReasons)
		if i.TriageReasons == nil {
			i.TriageReasons = []string{}
		}
	}
	return i, err
}

// List devuelve los incidentes más recientes; si reporter != "" solo los de ese usuario.
func (s *Store) List(ctx context.Context, reporter string) ([]Incident, error) {
	q := `SELECT ` + cols + ` FROM incidents`
	args := []any{}
	if reporter != "" {
		q += ` WHERE reported_by = $1`
		args = append(args, reporter)
	}
	rows, err := s.db.Query(ctx, q+` ORDER BY created_at DESC LIMIT 200`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Incident{}
	for rows.Next() {
		i, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

// ErrNotFound indica que el incidente no existe.
var ErrNotFound = errors.New("incidente no encontrado")

// Get busca un incidente por id.
func (s *Store) Get(ctx context.Context, id string) (Incident, error) {
	i, err := scan(s.db.QueryRow(ctx, `SELECT `+cols+` FROM incidents WHERE id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return i, ErrNotFound
	}
	return i, err
}

// insertOutbox guarda el evento y el contexto de la traza actual (traceparent), para que
// la publicación diferida siga siendo parte de la misma traza distribuida.
func insertOutbox(ctx context.Context, tx pgx.Tx, ev bus.Event) error {
	raw, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)
	trace, _ := json.Marshal(carrier)
	_, err = tx.Exec(ctx, `INSERT INTO outbox (id, event, trace) VALUES ($1, $2, $3)`, ev.ID, raw, trace)
	return err
}

// Create guarda el incidente y su evento IncidentCreated en una sola transacción.
func (s *Store) Create(ctx context.Context, inc Incident, ev bus.Event) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	reasons, _ := json.Marshal(inc.TriageReasons)
	_, err = tx.Exec(ctx, `INSERT INTO incidents (`+cols+`) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
		inc.ID, inc.Title, inc.Type, inc.Description, inc.Asset, inc.Status, inc.Severity, reasons,
		inc.ReportedBy, inc.EvidenceKey, inc.EvidenceName, inc.CreatedAt, inc.UpdatedAt)
	if err != nil {
		return err
	}
	if err := insertOutbox(ctx, tx, ev); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ErrTransition indica un cambio de estado no permitido.
var ErrTransition = errors.New("transición de estado no permitida")

// Transiciones manuales permitidas. "Nuevo → Clasificado" la hace solo Triage Service.
var transitions = map[string][]string{
	"Clasificado": {"En análisis"},
	"En análisis": {"Resuelto"},
	"Resuelto":    {"En análisis"}, // reabrir
}

// AllowedTransition indica si from → to es un cambio manual válido.
func AllowedTransition(from, to string) bool {
	for _, t := range transitions[from] {
		if t == to {
			return true
		}
	}
	return false
}

// ChangeStatus cambia el estado (bloqueando la fila) y guarda IncidentStatusChanged en el outbox.
func (s *Store) ChangeStatus(ctx context.Context, b *bus.Bus, id, to, by string) (Incident, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Incident{}, err
	}
	defer tx.Rollback(ctx)
	inc, err := scan(tx.QueryRow(ctx, `SELECT `+cols+` FROM incidents WHERE id = $1 FOR UPDATE`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return inc, ErrNotFound
	} else if err != nil {
		return inc, err
	}
	if !AllowedTransition(inc.Status, to) {
		return inc, fmt.Errorf("%w: %s → %s", ErrTransition, inc.Status, to)
	}
	from := inc.Status
	inc.Status, inc.UpdatedAt = to, time.Now().UTC()
	if _, err := tx.Exec(ctx, `UPDATE incidents SET status = $2, updated_at = $3 WHERE id = $1`, id, to, inc.UpdatedAt); err != nil {
		return inc, err
	}
	ev, err := b.NewEvent(bus.IncidentStatusChanged, bus.IncidentStatusChangedData{IncidentID: id, Title: inc.Title, From: from, To: to, By: by})
	if err != nil {
		return inc, err
	}
	if err := insertOutbox(ctx, tx, ev); err != nil {
		return inc, err
	}
	return inc, tx.Commit(ctx)
}

// ApplyTriage guarda la severidad calculada por Triage Service (idempotente).
func (s *Store) ApplyTriage(ctx context.Context, d bus.IncidentTriagedData) error {
	reasons, _ := json.Marshal(d.Reasons)
	_, err := s.db.Exec(ctx, `UPDATE incidents
		SET severity = $2, triage_reasons = $3,
		    status = CASE WHEN status = 'Nuevo' THEN 'Clasificado' ELSE status END,
		    updated_at = now()
		WHERE id = $1`, d.IncidentID, d.Severity, reasons)
	if err == nil {
		slog.Info("severidad aplicada", "incident", d.IncidentID, "severity", d.Severity)
	}
	return err
}

// RunOutboxRelay publica en el Event Bus los eventos pendientes del outbox.
// Si NATS está caído, los eventos esperan en la base y se publican al volver.
func (s *Store) RunOutboxRelay(ctx context.Context, b *bus.Bus) {
	tick := time.NewTicker(300 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if err := s.relayOnce(ctx, b); err != nil && !strings.Contains(err.Error(), "context canceled") {
				slog.Warn("outbox: reintento pendiente", "err", err)
			}
		}
	}
}

func (s *Store) relayOnce(ctx context.Context, b *bus.Bus) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `SELECT id, event, trace FROM outbox WHERE published_at IS NULL
		ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED`)
	if err != nil {
		return err
	}
	type item struct {
		id    string
		ev    bus.Event
		trace propagation.MapCarrier
	}
	var items []item
	for rows.Next() {
		var it item
		var raw, trace []byte
		if err := rows.Scan(&it.id, &raw, &trace); err != nil {
			rows.Close()
			return err
		}
		_ = json.Unmarshal(trace, &it.trace)
		if err := json.Unmarshal(raw, &it.ev); err == nil {
			items = append(items, it)
		}
	}
	rows.Close()
	for _, it := range items {
		pctx := otel.GetTextMapPropagator().Extract(ctx, it.trace)
		if err := b.PublishEvent(pctx, it.ev); err != nil {
			break // se reintenta en el próximo ciclo; Nats-Msg-Id evita duplicados
		}
		if _, err := tx.Exec(ctx, `UPDATE outbox SET published_at = now() WHERE id = $1`, it.id); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
