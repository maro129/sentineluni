// Package bus es el cliente del Event Bus (NATS JetStream) que usan backend y consumers.
//
// Cada evento viaja en el subject "sentinel.<Tipo>" con un sobre estándar. JetStream guarda
// los eventos en disco (stream SENTINEL) y cada consumer tiene un consumidor *durable*:
// si el servicio está caído, los eventos lo esperan y se entregan al volver (at-least-once).
package bus

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"

	"sentineluni/pkg/obs"
)

const (
	// Stream es el nombre del stream de JetStream con todos los eventos del sistema.
	Stream = "SENTINEL"
	// Prefix es el prefijo de subject de todos los eventos.
	Prefix = "sentinel."
)

// Tipos de evento del dominio (nombrados en pasado).
const (
	IncidentCreated       = "IncidentCreated"
	IncidentTriaged       = "IncidentTriaged"
	IncidentStatusChanged = "IncidentStatusChanged"
)

// Event es el sobre estándar de todos los eventos.
type Event struct {
	ID        string          `json:"id"`
	Type      string          `json:"type"`
	Source    string          `json:"source"`
	Timestamp time.Time       `json:"timestamp"`
	Data      json.RawMessage `json:"data"`
}

// Decode deserializa Data en v.
func (e Event) Decode(v any) error { return json.Unmarshal(e.Data, v) }

// Bus es una conexión al Event Bus.
type Bus struct {
	nc     *nats.Conn
	js     jetstream.JetStream
	source string
}

// NewID genera un identificador aleatorio en hexadecimal.
func NewID(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Connect se conecta a NATS (reintentando) y asegura que exista el stream SENTINEL.
//
// TLS: si NATS_CA_FILE apunta al certificado de la CA interna, la conexión se cifra con TLS
// y se verifica que el servidor sea realmente "nats" (la URL debe ser tls://nats:4222).
func Connect(ctx context.Context, url, source string) (*Bus, error) {
	opts := []nats.Option{nats.Name(source), nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1), nats.ReconnectWait(time.Second)}
	if ca := os.Getenv("NATS_CA_FILE"); ca != "" {
		opts = append(opts, nats.RootCAs(ca))
		slog.Info("Event Bus con TLS", "ca", ca)
	}
	nc, err := nats.Connect(url, opts...)
	if err != nil {
		return nil, err
	}
	js, err := jetstream.New(nc)
	if err != nil {
		return nil, err
	}
	cfg := jetstream.StreamConfig{
		Name: Stream, Subjects: []string{Prefix + ">"}, Storage: jetstream.FileStorage,
		MaxAge: 7 * 24 * time.Hour, Duplicates: 2 * time.Minute,
	}
	for {
		_, err = js.CreateOrUpdateStream(ctx, cfg)
		if err == nil {
			break
		}
		slog.Warn("esperando al Event Bus", "url", url, "err", err)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	slog.Info("conectado al Event Bus", "url", url, "stream", Stream)
	return &Bus{nc: nc, js: js, source: source}, nil
}

// Close cierra la conexión.
func (b *Bus) Close() { b.nc.Drain() }

// Connected indica si la conexión con NATS está activa.
func (b *Bus) Connected() bool { return b.nc.IsConnected() }

// NewEvent arma un sobre con id, tipo, fuente y fecha.
func (b *Bus) NewEvent(typ string, data any) (Event, error) {
	raw, err := json.Marshal(data)
	if err != nil {
		return Event{}, err
	}
	return Event{ID: NewID(16), Type: typ, Source: b.source, Timestamp: time.Now().UTC(), Data: raw}, nil
}

// PublishEvent publica un evento ya armado. El ID va en Nats-Msg-Id para que JetStream
// descarte duplicados si el mismo evento se reintenta (por ejemplo desde el outbox).
func (b *Bus) PublishEvent(ctx context.Context, ev Event) error {
	ctx, span := otel.Tracer("sentineluni/bus").Start(ctx, "publish "+ev.Type,
		trace.WithSpanKind(trace.SpanKindProducer), trace.WithAttributes(attribute.String("messaging.system", "nats")))
	defer span.End()
	body, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	msg := &nats.Msg{Subject: Prefix + ev.Type, Data: body, Header: nats.Header{}}
	msg.Header.Set(jetstream.MsgIDHeader, ev.ID)
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(http.Header(msg.Header)))
	if _, err := b.js.PublishMsg(ctx, msg); err != nil {
		span.RecordError(err)
		return fmt.Errorf("publicar %s: %w", ev.Type, err)
	}
	obs.EventsPublished.WithLabelValues(b.source, ev.Type).Inc()
	slog.Info("evento publicado", "type", ev.Type, "id", ev.ID)
	return nil
}

// Publish arma y publica un evento.
func (b *Bus) Publish(ctx context.Context, typ string, data any) (Event, error) {
	ev, err := b.NewEvent(typ, data)
	if err != nil {
		return ev, err
	}
	return ev, b.PublishEvent(ctx, ev)
}

// Handler procesa un evento; si devuelve error el evento se reintenta.
type Handler func(ctx context.Context, ev Event) error

// Subscribe crea (o actualiza) un consumidor durable que recibe los tipos indicados.
// types vacío = todos los eventos ("sentinel.>"). Confirmación explícita y hasta 5 intentos.
func (b *Bus) Subscribe(ctx context.Context, durable string, types []string, h Handler) (jetstream.ConsumeContext, error) {
	subjects := []string{Prefix + ">"}
	if len(types) > 0 {
		subjects = subjects[:0]
		for _, t := range types {
			subjects = append(subjects, Prefix+t)
		}
	}
	cons, err := b.js.CreateOrUpdateConsumer(ctx, Stream, jetstream.ConsumerConfig{
		Durable: durable, FilterSubjects: subjects, AckPolicy: jetstream.AckExplicitPolicy,
		DeliverPolicy: jetstream.DeliverAllPolicy, MaxDeliver: 5, AckWait: 30 * time.Second,
	})
	if err != nil {
		return nil, fmt.Errorf("crear consumidor %s: %w", durable, err)
	}
	slog.Info("suscrito al Event Bus", "durable", durable, "subjects", subjects)
	return cons.Consume(func(m jetstream.Msg) {
		var ev Event
		if err := json.Unmarshal(m.Data(), &ev); err != nil {
			slog.Error("evento mal formado, se descarta", "subject", m.Subject(), "err", err)
			_ = m.Term()
			return
		}
		pctx := otel.GetTextMapPropagator().Extract(context.Background(), propagation.HeaderCarrier(http.Header(m.Headers())))
		pctx, span := otel.Tracer("sentineluni/bus").Start(pctx, "consume "+ev.Type, trace.WithSpanKind(trace.SpanKindConsumer))
		defer span.End()
		if err := h(pctx, ev); err != nil {
			span.RecordError(err)
			obs.EventsProcessed.WithLabelValues(durable, ev.Type, "error").Inc()
			slog.Error("error procesando evento, se reintentará", "type", ev.Type, "id", ev.ID, "err", err)
			_ = m.NakWithDelay(2 * time.Second)
			return
		}
		obs.EventsProcessed.WithLabelValues(durable, ev.Type, "ok").Inc()
		_ = m.Ack()
	})
}

// Domain payloads compartidos entre productores y consumidores.

// IncidentCreatedData es el contenido de IncidentCreated.
type IncidentCreatedData struct {
	IncidentID  string `json:"incidentId"`
	Title       string `json:"title"`
	Type        string `json:"type"`
	Description string `json:"description"`
	Asset       string `json:"asset"`
	ReportedBy  string `json:"reportedBy"`
	HasEvidence bool   `json:"hasEvidence"`
}

// IncidentTriagedData es el contenido de IncidentTriaged.
type IncidentTriagedData struct {
	IncidentID string   `json:"incidentId"`
	Title      string   `json:"title"`
	Type       string   `json:"type"`
	Severity   string   `json:"severity"`
	Reasons    []string `json:"reasons"`
}

// IncidentStatusChangedData es el contenido de IncidentStatusChanged.
type IncidentStatusChangedData struct {
	IncidentID string `json:"incidentId"`
	Title      string `json:"title"`
	From       string `json:"from"`
	To         string `json:"to"`
	By         string `json:"by"`
}
