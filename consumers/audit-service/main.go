// AUDIT SERVICE (Event Consumer, Go): bitácora de TODOS los eventos + estadísticas.
//   - Se suscribe con comodín (sentinel.>): recibe cualquier evento sin que nadie lo llame.
//   - Guarda cada evento como documento en MongoDB (NoSQL) y mantiene contadores en Redis (caché).
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"

	"sentineluni/pkg/bus"
	"sentineluni/pkg/config"
	"sentineluni/pkg/httpx"
	"sentineluni/pkg/obs"
)

const service = "audit-service"

// Entry es un evento guardado en la bitácora.
type Entry struct {
	ID         string         `bson:"_id" json:"id"`
	Type       string         `bson:"type" json:"type"`
	Source     string         `bson:"source" json:"source"`
	Timestamp  time.Time      `bson:"timestamp" json:"timestamp"`
	IncidentID string         `bson:"incidentId,omitempty" json:"incidentId,omitempty"`
	Data       map[string]any `bson:"data" json:"data"`
}

type app struct {
	events *mongo.Collection
	cache  *redis.Client
}

var severities = []string{"Baja", "Media", "Alta", "Crítica"}

func main() {
	obs.Logger(service)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	defer obs.InitTracing(ctx, service)(context.Background())

	mc, err := mongo.Connect(ctx, options.Client().ApplyURI(config.Env("MONGO_URL", "mongodb://localhost:27017")).
		SetServerSelectionTimeout(60*time.Second))
	if err != nil {
		slog.Error("no se pudo abrir MongoDB", "err", err)
		os.Exit(1)
	}
	events := mc.Database(config.Env("MONGO_DB", "audit_db")).Collection("events")
	if _, err := events.Indexes().CreateOne(ctx, mongo.IndexModel{Keys: bson.D{{Key: "timestamp", Value: -1}}}); err != nil {
		slog.Error("MongoDB no responde", "err", err)
		os.Exit(1)
	}
	ropt, err := redis.ParseURL(config.Env("REDIS_URL", "redis://localhost:6379/0"))
	if err != nil {
		slog.Error("REDIS_URL inválido", "err", err)
		os.Exit(1)
	}
	a := &app{events: events, cache: redis.NewClient(ropt)}

	b, err := bus.Connect(ctx, config.Env("NATS_URL", "nats://localhost:4222"), service)
	if err != nil {
		slog.Error("no se pudo conectar al Event Bus", "err", err)
		os.Exit(1)
	}
	defer b.Close()
	if _, err := b.Subscribe(ctx, service, nil, a.record); err != nil {
		slog.Error("no se pudo suscribir", "err", err)
		os.Exit(1)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", httpx.Health)
	mux.HandleFunc("GET /audit", httpx.RequireRole(a.list, "analyst", "admin"))
	mux.HandleFunc("GET /audit/stats", httpx.RequireRole(a.stats, "analyst", "admin"))
	go func() { <-ctx.Done(); os.Exit(0) }()
	if err := obs.Serve(":"+config.Env("PORT", "8080"), obs.Handler(service, mux)); err != nil {
		slog.Error("servidor detenido", "err", err)
	}
}

// record guarda el evento (una sola vez, _id = id del evento) y actualiza los contadores.
func (a *app) record(ctx context.Context, ev bus.Event) error {
	var data map[string]any
	_ = ev.Decode(&data)
	incidentID, _ := data["incidentId"].(string)
	_, err := a.events.InsertOne(ctx, Entry{ID: ev.ID, Type: ev.Type, Source: ev.Source, Timestamp: ev.Timestamp, IncidentID: incidentID, Data: data})
	if mongo.IsDuplicateKeyError(err) {
		return nil // evento repetido: ya está en la bitácora y en los contadores
	}
	if err != nil {
		return err
	}
	pipe := a.cache.TxPipeline()
	pipe.Incr(ctx, "audit:total")
	pipe.HIncrBy(ctx, "audit:byType", ev.Type, 1)
	if sev, _ := data["severity"].(string); ev.Type == bus.IncidentTriaged && sev != "" {
		pipe.HIncrBy(ctx, "audit:bySeverity", sev, 1)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		slog.Warn("Redis no disponible; las estadísticas se recalculan desde MongoDB", "err", err)
		_ = a.cache.Del(ctx, "audit:total").Err()
	}
	return nil
}

func (a *app) list(w http.ResponseWriter, r *http.Request) {
	cur, err := a.events.Find(r.Context(), bson.D{}, options.Find().SetSort(bson.D{{Key: "timestamp", Value: -1}}).SetLimit(40))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Error al leer la bitácora")
		return
	}
	out := []Entry{}
	if err := cur.All(r.Context(), &out); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Error al leer la bitácora")
		return
	}
	httpx.JSON(w, http.StatusOK, out)
}

type statsResp struct {
	TotalEvents int64            `json:"totalEvents"`
	ByType      map[string]int64 `json:"byType"`
	BySeverity  map[string]int64 `json:"bySeverity"`
	Source      string           `json:"source"`
}

// stats lee los contadores de Redis (rápido); si la caché está vacía, los reconstruye desde MongoDB.
func (a *app) stats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if s, err := a.statsFromCache(ctx); err == nil {
		httpx.JSON(w, http.StatusOK, s)
		return
	}
	s, err := a.statsFromMongo(ctx)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "Error al calcular estadísticas")
		return
	}
	a.warmCache(ctx, s)
	httpx.JSON(w, http.StatusOK, s)
}

func newStats(source string) statsResp {
	s := statsResp{ByType: map[string]int64{}, BySeverity: map[string]int64{}, Source: source}
	for _, sev := range severities {
		s.BySeverity[sev] = 0
	}
	return s
}

func toInt64Map(m map[string]string, into map[string]int64) {
	for k, v := range m {
		n, _ := strconv.ParseInt(v, 10, 64)
		into[k] = n
	}
}

func (a *app) statsFromCache(ctx context.Context) (statsResp, error) {
	total, err := a.cache.Get(ctx, "audit:total").Int64()
	if err != nil {
		return statsResp{}, errors.New("caché vacía")
	}
	s := newStats("redis")
	s.TotalEvents = total
	byType, _ := a.cache.HGetAll(ctx, "audit:byType").Result()
	bySev, _ := a.cache.HGetAll(ctx, "audit:bySeverity").Result()
	toInt64Map(byType, s.ByType)
	toInt64Map(bySev, s.BySeverity)
	return s, nil
}

func (a *app) statsFromMongo(ctx context.Context) (statsResp, error) {
	s := newStats("mongodb")
	cur, err := a.events.Aggregate(ctx, mongo.Pipeline{{{Key: "$group", Value: bson.D{{Key: "_id", Value: "$type"}, {Key: "n", Value: bson.D{{Key: "$sum", Value: 1}}}}}}})
	if err != nil {
		return s, err
	}
	var rows []struct {
		ID string `bson:"_id"`
		N  int64  `bson:"n"`
	}
	if err := cur.All(ctx, &rows); err != nil {
		return s, err
	}
	for _, r := range rows {
		s.ByType[r.ID] = r.N
		s.TotalEvents += r.N
	}
	cur, err = a.events.Aggregate(ctx, mongo.Pipeline{
		{{Key: "$match", Value: bson.D{{Key: "type", Value: bus.IncidentTriaged}}}},
		{{Key: "$group", Value: bson.D{{Key: "_id", Value: "$data.severity"}, {Key: "n", Value: bson.D{{Key: "$sum", Value: 1}}}}}},
	})
	if err != nil {
		return s, err
	}
	rows = nil
	if err := cur.All(ctx, &rows); err != nil {
		return s, err
	}
	for _, r := range rows {
		s.BySeverity[r.ID] = r.N
	}
	return s, nil
}

func (a *app) warmCache(ctx context.Context, s statsResp) {
	pipe := a.cache.TxPipeline()
	pipe.Del(ctx, "audit:byType", "audit:bySeverity")
	for k, v := range s.ByType {
		pipe.HSet(ctx, "audit:byType", k, v)
	}
	for k, v := range s.BySeverity {
		pipe.HSet(ctx, "audit:bySeverity", k, v)
	}
	pipe.Set(ctx, "audit:total", s.TotalEvents, 0)
	_, _ = pipe.Exec(ctx)
}
