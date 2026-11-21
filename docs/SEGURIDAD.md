# Seguridad de SentinelUNI (punto 7 del curso: WAF, TLS y Keycloak)

La diapositiva *7. Seguridad* propone esta cadena:

```
React → TLS → Keycloak (RS256) → JWT → TLS → WAF → Kong → NestJS → TLS → Kafka → TLS → PostgreSQL
```

SentinelUNI la implementa con las mismas piezas; donde el curso nombra una herramienta y el proyecto ya
usaba otra de la misma lista (Kong → **Traefik**, Kafka → **NATS JetStream**), se mantiene la del proyecto:

```
React (shell + microfrontends)
   │ 1. login en la pantalla de Keycloak (OpenID Connect, Authorization Code + PKCE)
   ▼
Keycloak ── emite el JWT firmado con RS256 (llave privada solo en Keycloak)
   │
   ▼  cada petición: Authorization: Bearer <JWT>
──TLS──▶ WAF  (ModSecurity + OWASP Core Rule Set: bloquea SQLi, XSS, path traversal, escáneres…)
──TLS──▶ Traefik (API Gateway: valida el JWT con la llave pública de Keycloak, rate limiting, logs)
   ▼
NestJS (User Service) · Go (Incident Service)
──TLS──▶ NATS JetStream (Event Bus)  ──▶ consumers en Go
──TLS──▶ PostgreSQL (TLS obligatorio: pg_hba rechaza conexiones sin cifrar)
```

## 1. WAF (Web Application Firewall)

Un firewall tradicional filtra puertos e IPs. Un **WAF filtra el contenido de las peticiones HTTP/HTTPS**:
parámetros, cabeceras y cuerpo. SentinelUNI usa la imagen oficial **OWASP ModSecurity + Core Rule Set (CRS)**
con nginx, delante del API Gateway.

| Qué | Dónde |
|---|---|
| Contenedor | `waf` en `docker-compose.yml` (imagen `owasp/modsecurity-crs:nginx-alpine`) |
| Único servicio publicado hacia afuera | puertos 80 (redirige a HTTPS) y 443 |
| Reglas | OWASP CRS 4, *paranoia level* 1, bloqueo a partir de un puntaje de anomalía de 5 |
| Métodos permitidos | `GET HEAD POST OPTIONS PATCH` (PATCH es el cambio de estado de incidentes) |
| Registro | `docker compose logs waf` (auditoría en JSON de lo bloqueado) |

Traefik **ya no publica los puertos 80/443**: si alguien quisiera saltarse el WAF, no tiene cómo llegar al
Gateway.

## 2. TLS (Transport Layer Security)

TLS cifra cada tramo para que nadie pueda leer ni modificar los datos en tránsito, y el certificado prueba
que el servidor es quien dice ser. El contenedor `certs-init` crea una **CA interna** (`SentinelUNI Internal CA`)
y un certificado por servidor; los clientes verifican ese certificado contra la CA.

| Tramo | Cómo se configura | Verificación del certificado |
|---|---|---|
| Navegador → WAF | `SSL_CERT_FILE=/certs/waf.crt`; HTTP se redirige a HTTPS | el navegador (instala la CA para quitar la advertencia) |
| WAF → Traefik | `BACKEND=https://traefik:443`; Traefik usa `traefik.crt` (`gateway/dynamic/tls.yml`), TLS 1.2+ | cifrado |
| Traefik → Keycloak | `https://keycloak:8443`, `serversTransport` con la CA interna | sí (`serverName: keycloak`) |
| User Service → Keycloak | JWKS y token por `https://keycloak:8443` (`NODE_EXTRA_CA_CERTS`) | sí |
| Servicios Go → NATS | `tls://nats:4222` + `NATS_CA_FILE`; NATS exige TLS (`--tls`) | sí |
| Servicios y Keycloak → PostgreSQL | `sslmode=verify-full&sslrootcert=/certs/ca.crt`; `pg_hba.conf` con `hostnossl … reject` | sí (`verify-full` = cifrado + nombre del servidor) |

Las llaves privadas tienen permisos `600` y pertenecen solo al usuario del contenedor que las usa. La llave
de la CA se borra después de emitir los certificados.

## 3. Keycloak (servidor de identidad)

| Antes (entrega 2) | Ahora |
|---|---|
| User Service guardaba contraseñas y firmaba el JWT con **HS256** (un secreto compartido en `.env`) | **Keycloak** guarda los usuarios y firma el JWT con **RS256** (llave privada solo en Keycloak) |
| Formulario de login propio en React | Pantalla de login de Keycloak (Authorization Code + **PKCE**); la contraseña nunca pasa por la app |
| Si alguien obtenía el secreto, podía fabricar un token de admin | Los servicios solo tienen la llave **pública** (JWKS): no sirve para firmar |

Configuración (`infra/keycloak/sentineluni-realm.json`, se importa al arrancar):

- Realm `sentineluni`, firma por defecto **RS256**, tokens de 15 minutos.
- Roles `admin`, `analyst`, `reporter` y los tres usuarios de prueba (mismas contraseñas de siempre).
- Clientes: `sentinel-web` (React, público, PKCE S256), `sentinel-mobile` (app móvil y `POST /api/auth/login`),
  `sentineluni-api` (audiencia: los tokens dicen para qué API fueron emitidos).
- Protección contra fuerza bruta: 5 contraseñas erradas bloquean la cuenta temporalmente.

Cómo interactúa con cada parte (como pide la diapositiva):

- **React:** `frontend/shell/src/auth.ts` usa `keycloak-js`: redirige al login, recibe el token, lo renueva y cierra la sesión.
- **API Gateway:** el *forwardAuth* de Traefik llama a `user-service /auth/verify` en cada petición.
- **Microservicios:** User Service (NestJS + `jose`) valida firma RS256, emisor (`iss`), audiencia (`aud`),
  expiración, cliente (`azp`) y rol, y el Gateway pasa la identidad (`X-User`, `X-Role`) a los servicios Go.

## Cómo comprobarlo (para la demo)

Ejecuta los comandos en PowerShell, dentro de la carpeta del proyecto.

**WAF bloqueando ataques** (deben responder `403 Forbidden`; el path traversal puede salir `400`, que nginx corta antes):

```powershell
curl.exe -k -i "https://localhost/api/incidents?id=1%27%20OR%20%271%27=%271"
curl.exe -k -i "https://localhost/?q=%3Cscript%3Ealert(1)%3C/script%3E"
curl.exe -k -i "https://localhost/../../etc/passwd" --path-as-is
docker compose logs waf --tail 20
```

Una petición normal sí pasa: `curl.exe -k -i https://localhost/api/health/users` → `200`.

**JWT RS256 de Keycloak:**

```powershell
curl.exe -k -s -X POST https://localhost/api/auth/login -H "Content-Type: application/json" -d '{\"username\":\"analista\",\"password\":\"analista123\"}'
```

Copia el `token` y pégalo en <https://jwt.io>: la cabecera dice `"alg": "RS256"` y el cuerpo trae
`iss: https://localhost/auth/realms/sentineluni`, `aud: sentineluni-api` y `realm_access.roles`.
La llave pública está en <https://localhost/auth/realms/sentineluni/protocol/openid-connect/certs>.

**TLS hacia PostgreSQL** (la columna `ssl` debe decir `t` en todas las conexiones):

```powershell
docker compose exec postgres psql -U postgres -c "SELECT a.usename, a.datname, s.ssl, s.version FROM pg_stat_ssl s JOIN pg_stat_activity a USING (pid) WHERE a.usename IS NOT NULL;"
```

**TLS hacia NATS:** abre <http://localhost:8222/connz>: cada conexión muestra `tls_version` y `tls_cipher_suite`.

**Consola de Keycloak:** <https://localhost/auth/admin> con `kcadmin` y `KEYCLOAK_ADMIN_PASSWORD`; en el realm
*sentineluni* → *Realm settings* → *Keys* se ve la llave RS256 activa.

## Confiar en la CA interna (opcional)

Quita la advertencia del navegador y permite instalar la PWA:

```powershell
docker compose cp certs-init:/certs/ca.crt .\sentineluni-ca.crt
```

Doble clic en `sentineluni-ca.crt` → *Instalar certificado* → *Usuario actual* → *Colocar todos los
certificados en el siguiente almacén* → **Entidades de certificación raíz de confianza** → Finalizar.
Cierra y abre el navegador. (Firefox: *Ajustes → Privacidad y seguridad → Certificados → Importar*.)

## Límites conocidos

- MongoDB y Redis siguen sin TLS dentro de la red interna (`backend`, sin salida a internet); el curso marca
  TLS hacia PostgreSQL y el Event Bus.
- Detrás del WAF, Traefik ve todas las peticiones desde la IP del WAF, así que su rate limiting es global (300/min).
- Los manifiestos de `k8s/` todavía no incluyen WAF, Keycloak ni TLS interno.
