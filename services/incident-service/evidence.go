package main

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"sentineluni/pkg/config"
)

// EvidenceStore guarda la evidencia de los incidentes en Object Storage (MinIO / S3).
type EvidenceStore struct {
	client *minio.Client
	bucket string
}

// NewEvidenceStore conecta con S3 y crea el bucket si no existe.
// Si el almacenamiento no responde, la evidencia queda deshabilitada pero el servicio sigue.
func NewEvidenceStore(ctx context.Context) *EvidenceStore {
	endpoint := config.Env("S3_ENDPOINT", "localhost:9000")
	c, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(config.Env("S3_ACCESS_KEY", "sentinel"), config.Env("S3_SECRET_KEY", "sentinel-secret"), ""),
		Secure: config.Env("S3_USE_SSL", "false") == "true",
		Region: config.Env("S3_REGION", "us-east-1"),
	})
	if err != nil {
		slog.Warn("Object Storage deshabilitado", "err", err)
		return &EvidenceStore{}
	}
	es := &EvidenceStore{client: c, bucket: config.Env("S3_BUCKET", "evidence")}
	go es.ensureBucket(ctx)
	return es
}

func (e *EvidenceStore) ensureBucket(ctx context.Context) {
	for i := 0; i < 30; i++ {
		exists, err := e.client.BucketExists(ctx, e.bucket)
		if err == nil && !exists {
			err = e.client.MakeBucket(ctx, e.bucket, minio.MakeBucketOptions{})
		}
		if err == nil {
			slog.Info("Object Storage listo", "bucket", e.bucket)
			return
		}
		slog.Warn("esperando a Object Storage", "err", err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Second):
		}
	}
}

// Enabled indica si hay Object Storage configurado.
func (e *EvidenceStore) Enabled() bool { return e.client != nil }

// Put sube un archivo y devuelve la clave del objeto.
func (e *EvidenceStore) Put(ctx context.Context, incidentID, filename, contentType string, r io.Reader, size int64) (string, error) {
	key := incidentID + "/" + safeName(filename)
	_, err := e.client.PutObject(ctx, e.bucket, key, r, size, minio.PutObjectOptions{ContentType: contentType})
	return key, err
}

// Get devuelve el objeto para descargarlo.
func (e *EvidenceStore) Get(ctx context.Context, key string) (*minio.Object, minio.ObjectInfo, error) {
	obj, err := e.client.GetObject(ctx, e.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, minio.ObjectInfo{}, err
	}
	info, err := obj.Stat()
	return obj, info, err
}

func safeName(name string) string {
	name = strings.TrimSpace(name)
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '.', r == '-', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	if b.Len() == 0 {
		return "evidencia"
	}
	s := b.String()
	if len(s) > 80 {
		s = s[len(s)-80:]
	}
	return s
}
