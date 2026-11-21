# SentinelUNI · Mini-SOC orientado a eventos

Proyecto del curso **CBS36-M Desarrollo de Aplicaciones Web (UNI)**. Aplicación web para reportar y
gestionar incidentes de seguridad, construida con la arquitectura full stack del curso:

```
Frontend (React + Webpack 5 Module Federation, PWA, React Native)
   ──TLS──▶ WAF (ModSecurity + OWASP Core Rule Set)
   ──TLS──▶ API Gateway (Traefik: JWT, rate limiting, logging, métricas, trazas)
   → Backend (User Service en NestJS · Incident Service en Go)
   ──TLS──▶ Event Bus (NATS JetStream)
   → Event Consumers (Triage, Notification, Audit en Go)
   ──TLS──▶ Datos (PostgreSQL · Redis · MongoDB · S3)
   + Identidad: Keycloak (OpenID Connect, JWT firmados con RS256)
   + Plataforma: Docker · Kubernetes · OpenTelemetry · Prometheus · Grafana · GitHub Actions
```

- **Seguridad (punto 7 del curso: WAF, TLS y Keycloak)** y cómo comprobarla: [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md).

## Requisitos

- **Docker Desktop** (o Docker Engine + Compose v2) con unos 7 GB de RAM libres.
- Solo para desarrollo sin Docker: Node.js 22 y Go 1.23.

## Cómo ejecutarlo

```bash
cp .env.example .env            # en Windows: copy .env.example .env   — luego cambia los secretos
docker compose up -d --build    # la primera vez tarda varios minutos (descarga y compila todo)
```

Abre **https://localhost**: la aplicación te lleva a la pantalla de login de **Keycloak**. Usuarios:

| Usuario | Contraseña | Rol | Qué puede hacer |
|---|---|---|---|
| `analista` | `analista123` | Analista | Ver todo, cambiar estados, ver avisos y bitácora |
| `admin` | `admin123` | Administrador | Igual que el analista |
| `usuario` | `usuario123` | Reportante | Reportar y ver **solo sus** incidentes |

### Certificado HTTPS

El contenedor `certs-init` crea una **CA interna** y los certificados TLS de cada servidor (WAF, Traefik,
Keycloak, NATS, PostgreSQL). El navegador muestra una advertencia porque no conoce esa CA: acéptala, o
instala la CA en Windows para que el candado salga en verde y la **PWA** pueda instalarse
(pasos en [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md#confiar-en-la-ca-interna-opcional)).

### Paneles (solo en tu máquina)

| Panel | URL |
|---|---|
| Aplicación (a través del WAF y el API Gateway) | https://localhost |
| Consola de Keycloak (usuario `kcadmin`, contraseña de `.env`) | https://localhost/auth/admin |
| Dashboard de Traefik | http://localhost:8081 |
| Grafana (usuario `admin`, contraseña de `.env`) | http://localhost:3001 |
| Prometheus | http://localhost:9090 |
| Jaeger (trazas OpenTelemetry) | http://localhost:16686 |
| Explorador de SeaweedFS (Object Storage S3) | http://localhost:9001 |
| Monitoreo de NATS | http://localhost:8222 |

## Estructura

```
sentineluni/
├─ frontend/                    React 18 + TypeScript + Webpack 5 (npm workspaces)
│  ├─ shell/                    host: login con Keycloak (PKCE), layout, PWA (service worker Workbox)
│  ├─ mfe-incidents/            microfrontend: reporte con evidencia y ciclo de vida
│  ├─ mfe-notifications/        microfrontend: avisos del SOC
│  ├─ mfe-audit/                microfrontend: indicadores y bitácora (expone 2 módulos)
│  └─ shared/                   tipos, cliente del API y componentes comunes
├─ mobile/                      React Native (Expo): login, reporte y seguimiento
├─ gateway/                     Traefik: traefik.yml, dynamic/routes.yml (rutas) y dynamic/tls.yml
├─ services/
│  ├─ user-service/             NestJS + TypeORM + PostgreSQL: valida JWT RS256 de Keycloak (/auth/verify)
│  └─ incident-service/         Go + PostgreSQL + S3: incidentes, outbox, evidencia
├─ consumers/
│  ├─ triage-service/           Go: IncidentCreated → severidad → IncidentTriaged
│  ├─ notification-service/     Go + PostgreSQL: avisos Alta/Crítica y Resuelto (+Telegram)
│  └─ audit-service/            Go + MongoDB + Redis: bitácora y estadísticas
├─ pkg/                         código Go compartido: bus (NATS), obs (métricas/trazas), httpx
├─ infra/postgres/              una base y un usuario por servicio + pg_hba.conf (TLS obligatorio)
├─ infra/keycloak/              realm "sentineluni": roles, usuarios y clientes OIDC
├─ infra/certs/                 script que crea la CA interna y los certificados TLS
├─ observability/               OTel Collector, Prometheus y dashboard de Grafana
├─ k8s/                         manifiestos de Kubernetes (kustomize) + IngressRoute de Traefik
├─ .github/workflows/ci.yml     CI: tests, govulncheck, npm audit, builds e imágenes a GHCR
├─ docker-compose.yml
└─ go.mod                       módulo Go de los servicios Go
```

## Rutas del API Gateway

| Método | Ruta | Servicio | Acceso |
|---|---|---|---|
| GET/POST | `/auth/...` | Keycloak (login, tokens, llaves públicas JWKS) | Público · por HTTPS |
| POST | `/api/auth/login` | User Service → Keycloak (app móvil y curl) | Público · 10 intentos/min |
| GET | `/api/incidents` | Incident Service | JWT · el reportante solo ve los suyos |
| POST | `/api/incidents` (JSON o multipart con `evidence`) | Incident Service | JWT |
| GET | `/api/incidents/:id/evidence` | Incident Service (S3) | JWT |
| PATCH | `/api/incidents/:id/status` | Incident Service | JWT · analista/admin |
| GET | `/api/notifications` · PATCH `/:id/read` | Notification Service | JWT · analista/admin |
| GET | `/api/audit` · `/api/audit/stats` | Audit Service | JWT · analista/admin |
| GET | `/api/health/{users,incidents,triage,notifications,audit}` | cada servicio | Público, sin rate limit |
| GET | `/mfe/{incidents,notifications,audit}/remoteEntry.js` | microfrontends | Público |

Antes de llegar al Gateway, **cada petición pasa por el WAF** (OWASP CRS), que bloquea con 403 los ataques
comunes. Todas las rutas de `/api` (salvo login y health) tienen rate limiting de **300 peticiones por minuto**.
El Gateway valida el JWT de Keycloak llamando a `user-service /auth/verify` (*forwardAuth*: firma RS256,
emisor, audiencia y expiración) y **reemplaza** las cabeceras `X-User` / `X-Role` con la identidad verificada.

## Eventos

| Evento | Lo publica | Lo consumen |
|---|---|---|
| `IncidentCreated` | Incident Service (vía outbox) | Triage Service, Audit Service |
| `IncidentTriaged` | Triage Service | Incident Service, Notification Service, Audit Service |
| `IncidentStatusChanged` | Incident Service (vía outbox) | Notification Service, Audit Service |

- **NATS JetStream** guarda los eventos en disco (stream `SENTINEL`, subjects `sentinel.<Evento>`).
- Cada consumer tiene un **consumidor durable**: si está caído, los eventos lo esperan.
- **Transactional Outbox**: el incidente y su evento se guardan en la misma transacción; si el bus
  está caído, el evento se publica cuando vuelve.
- **Idempotencia**: `Nats-Msg-Id` descarta duplicados en el bus y los consumers usan el id del evento
  como clave (la entrega es *at-least-once*).
- Ciclo de vida: `Nuevo → Clasificado` (automático) `→ En análisis → Resuelto` (y reabrir `Resuelto → En análisis`).

## Desarrollo sin reconstruir imágenes

```bash
docker compose up -d                                  # backend completo
cd frontend && npm install && npm run dev             # shell :4000 + MFEs :4001-4003 (proxy /api → https://localhost)
```

Pruebas: `go test ./...` · `cd services/user-service && npm test` · `cd frontend && npm run typecheck`.

> La primera compilación de los servicios Go ejecuta `go mod tidy`, que genera `go.sum` (requiere internet).

## Kubernetes

```bash
docker compose build                                   # imágenes sentineluni-<servicio>:latest
kind create cluster && for i in $(docker images --format '{{.Repository}}' | grep '^sentineluni-'); do kind load docker-image $i:latest; done
helm repo add traefik https://traefik.github.io/charts && helm install traefik traefik/traefik -n traefik --create-namespace
cp k8s/01-secrets.example.yaml k8s/01-secrets.yaml    # cambia los valores
kubectl apply -f k8s/00-namespace.yaml -f k8s/01-secrets.yaml && kubectl apply -k k8s
```

> **Pendiente:** los manifiestos de `k8s/` aún describen la versión anterior a la entrega de seguridad
> (secreto HS256 propio e imagen de MinIO). El despliegue de referencia con WAF, TLS y Keycloak es
> `docker-compose.yml`.
