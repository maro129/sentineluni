# SentinelUNI Â· Mini-SOC orientado a eventos

Proyecto del curso **CBS36-M Desarrollo de Aplicaciones Web (UNI)**. AplicaciÃ³n web para reportar y
gestionar incidentes de seguridad, construida con la arquitectura full stack del curso:

```
Frontend (React + Webpack 5 Module Federation, PWA, React Native)
   â†’ API Gateway (Traefik: HTTPS, JWT, rate limiting, logging, mÃ©tricas, trazas)
   â†’ Backend (User Service en NestJS Â· Incident Service en Go)
   â†’ Event Bus (NATS JetStream)
   â†’ Event Consumers (Triage, Notification, Audit en Go)
   â†’ Datos (PostgreSQL Â· Redis Â· MongoDB Â· MinIO/S3)
   + Plataforma: Docker Â· Kubernetes Â· OpenTelemetry Â· Prometheus Â· Grafana Â· GitHub Actions
```


## Requisitos

- **Docker Desktop** (o Docker Engine + Compose v2) con unos 6 GB de RAM libres.
- Opcional: [`mkcert`](https://github.com/FiloSottile/mkcert) para un certificado HTTPS de confianza.
- Solo para desarrollo sin Docker: Node.js 22 y Go 1.23.

## CÃ³mo ejecutarlo

```bash
cp .env.example .env            # en Windows: copy .env.example .env   â€” luego cambia los secretos
docker compose up -d --build    # la primera vez tarda varios minutos (descarga y compila todo)
```

Abre **https://localhost** e ingresa con:

| Usuario | ContraseÃ±a | Rol | QuÃ© puede hacer |
|---|---|---|---|
| `analista` | `analista123` | Analista | Ver todo, cambiar estados, ver avisos y bitÃ¡cora |
| `admin` | `admin123` | Administrador | Igual que el analista |
| `usuario` | `usuario123` | Reportante | Reportar y ver **solo sus** incidentes |

### Certificado HTTPS

Por defecto Traefik usa un certificado autofirmado (el navegador muestra una advertencia; acÃ©ptala).
Para que el navegador lo acepte y la **PWA** pueda instalarse y registrar su service worker:

```bash
./scripts/gen-certs.sh          # usa mkcert si estÃ¡ instalado
```

En Windows (PowerShell), con mkcert instalado:

```powershell
mkcert -install
mkcert -cert-file gateway/certs/localhost.pem -key-file gateway/certs/localhost-key.pem localhost 127.0.0.1 ::1
copy gateway\tls.yml.example gateway\dynamic\tls.yml
```

### Paneles (solo en tu mÃ¡quina)

| Panel | URL |
|---|---|
| AplicaciÃ³n (a travÃ©s del API Gateway) | https://localhost |
| Dashboard de Traefik | http://localhost:8081 |
| Grafana (usuario `admin`, contraseÃ±a de `.env`) | http://localhost:3001 |
| Prometheus | http://localhost:9090 |
| Jaeger (trazas OpenTelemetry) | http://localhost:16686 |
| Consola de MinIO (Object Storage) | http://localhost:9001 |
| Monitoreo de NATS | http://localhost:8222 |

## Estructura

```
sentineluni/
â”œâ”€ frontend/                    React 18 + TypeScript + Webpack 5 (npm workspaces)
â”‚  â”œâ”€ shell/                    host: login, layout, PWA (manifest + service worker Workbox)
â”‚  â”œâ”€ mfe-incidents/            microfrontend: reporte con evidencia y ciclo de vida
â”‚  â”œâ”€ mfe-notifications/        microfrontend: avisos del SOC
â”‚  â”œâ”€ mfe-audit/                microfrontend: indicadores y bitÃ¡cora (expone 2 mÃ³dulos)
â”‚  â””â”€ shared/                   tipos, cliente del API y componentes comunes
â”œâ”€ mobile/                      React Native (Expo): login, reporte y seguimiento
â”œâ”€ gateway/                     Traefik: traefik.yml (estÃ¡tico) y dynamic/routes.yml (rutas)
â”œâ”€ services/
â”‚  â”œâ”€ user-service/             NestJS + TypeORM + PostgreSQL: login, JWT y /auth/verify
â”‚  â””â”€ incident-service/         Go + PostgreSQL + MinIO: incidentes, outbox, evidencia
â”œâ”€ consumers/
â”‚  â”œâ”€ triage-service/           Go: IncidentCreated â†’ severidad â†’ IncidentTriaged
â”‚  â”œâ”€ notification-service/     Go + PostgreSQL: avisos Alta/CrÃ­tica y Resuelto (+Telegram)
â”‚  â””â”€ audit-service/            Go + MongoDB + Redis: bitÃ¡cora y estadÃ­sticas
â”œâ”€ pkg/                         cÃ³digo Go compartido: bus (NATS), obs (mÃ©tricas/trazas), httpx
â”œâ”€ infra/postgres/              una base y un usuario por microservicio
â”œâ”€ observability/               OTel Collector, Prometheus y dashboard de Grafana
â”œâ”€ k8s/                         manifiestos de Kubernetes (kustomize) + IngressRoute de Traefik
â”œâ”€ .github/workflows/ci.yml     CI: tests, govulncheck, npm audit, builds e imÃ¡genes a GHCR
â”œâ”€ docker-compose.yml
â””â”€ go.mod                       mÃ³dulo Go de los servicios Go
```

## Rutas del API Gateway

| MÃ©todo | Ruta | Servicio | Acceso |
|---|---|---|---|
| POST | `/api/auth/login` | User Service | PÃºblico Â· 10 intentos/min por IP |
| GET | `/api/incidents` | Incident Service | JWT Â· el reportante solo ve los suyos |
| POST | `/api/incidents` (JSON o multipart con `evidence`) | Incident Service | JWT |
| GET | `/api/incidents/:id/evidence` | Incident Service (MinIO) | JWT |
| PATCH | `/api/incidents/:id/status` | Incident Service | JWT Â· analista/admin |
| GET | `/api/notifications` Â· PATCH `/:id/read` | Notification Service | JWT Â· analista/admin |
| GET | `/api/audit` Â· `/api/audit/stats` | Audit Service | JWT Â· analista/admin |
| GET | `/api/health/{users,incidents,triage,notifications,audit}` | cada servicio | PÃºblico, sin rate limit |
| GET | `/mfe/{incidents,notifications,audit}/remoteEntry.js` | microfrontends | PÃºblico |

Todas las rutas de `/api` (salvo login y health) tienen rate limiting de **100 peticiones por minuto por IP**.
El Gateway valida el JWT llamando a `user-service /auth/verify` (*forwardAuth*) y **reemplaza**
las cabeceras `X-User` / `X-Role` con la identidad verificada antes de enrutar.

## Eventos

| Evento | Lo publica | Lo consumen |
|---|---|---|
| `IncidentCreated` | Incident Service (vÃ­a outbox) | Triage Service, Audit Service |
| `IncidentTriaged` | Triage Service | Incident Service, Notification Service, Audit Service |
| `IncidentStatusChanged` | Incident Service (vÃ­a outbox) | Notification Service, Audit Service |

- **NATS JetStream** guarda los eventos en disco (stream `SENTINEL`, subjects `sentinel.<Evento>`).
- Cada consumer tiene un **consumidor durable**: si estÃ¡ caÃ­do, los eventos lo esperan.
- **Transactional Outbox**: el incidente y su evento se guardan en la misma transacciÃ³n; si el bus
  estÃ¡ caÃ­do, el evento se publica cuando vuelve.
- **Idempotencia**: `Nats-Msg-Id` descarta duplicados en el bus y los consumers usan el id del evento
  como clave (la entrega es *at-least-once*).
- Ciclo de vida: `Nuevo â†’ Clasificado` (automÃ¡tico) `â†’ En anÃ¡lisis â†’ Resuelto` (y reabrir `Resuelto â†’ En anÃ¡lisis`).

## Desarrollo sin reconstruir imÃ¡genes

```bash
docker compose up -d                                  # backend completo
cd frontend && npm install && npm run dev             # shell :4000 + MFEs :4001-4003 (proxy /api â†’ https://localhost)
```

Pruebas: `go test ./...` Â· `cd services/user-service && npm test` Â· `cd frontend && npm run typecheck`.

> La primera compilaciÃ³n de los servicios Go ejecuta `go mod tidy`, que genera `go.sum` (requiere internet).

## Kubernetes

```bash
docker compose build                                   # imÃ¡genes sentineluni-<servicio>:latest
kind create cluster && for i in $(docker images --format '{{.Repository}}' | grep '^sentineluni-'); do kind load docker-image $i:latest; done
helm repo add traefik https://traefik.github.io/charts && helm install traefik traefik/traefik -n traefik --create-namespace
cp k8s/01-secrets.example.yaml k8s/01-secrets.yaml    # cambia los valores
kubectl apply -f k8s/00-namespace.yaml -f k8s/01-secrets.yaml && kubectl apply -k k8s
```
