#!/bin/sh
# TLS INTERNO de SentinelUNI: crea una Autoridad Certificadora (CA) propia y un certificado
# por cada servidor que habla TLS. Lo ejecuta el contenedor "certs-init" de docker compose
# (funciona igual en Windows, macOS o Linux: no hace falta instalar openssl en tu PC).
#
#   navegador ──TLS──▶ waf ──TLS──▶ traefik ──TLS──▶ keycloak
#   servicios ──TLS──▶ nats (Event Bus)      servicios/keycloak ──TLS──▶ postgres
#
# Los archivos quedan en el volumen "certs" (montado en /certs, solo lectura, en cada servicio).
# Es idempotente: si la CA ya existe no hace nada. Para regenerar: docker compose down -v
set -eu
OUT=/certs
DAYS=825
cd "$OUT"

if [ -f ca.crt ] && [ -f waf.crt ]; then
  echo "certs-init: los certificados ya existen, no se regeneran"
  exit 0
fi

echo "certs-init: creando la CA interna de SentinelUNI"
openssl req -x509 -newkey rsa:4096 -sha256 -nodes -days 3650 \
  -keyout ca.key -out ca.crt -subj "/O=SentinelUNI/CN=SentinelUNI Internal CA"

# issue <nombre> <SAN> <uid:gid dueño de la llave>
issue() {
  name=$1; san=$2; owner=$3
  openssl req -newkey rsa:2048 -nodes -keyout "$name.key" -out "$name.csr" \
    -subj "/O=SentinelUNI/CN=$name"
  printf 'subjectAltName=%s\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\nbasicConstraints=CA:FALSE\n' "$san" > "$name.ext"
  openssl x509 -req -in "$name.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
    -days "$DAYS" -sha256 -extfile "$name.ext" -out "$name.crt"
  rm -f "$name.csr" "$name.ext"
  chown "$owner" "$name.key" "$name.crt"
  chmod 600 "$name.key"
  chmod 644 "$name.crt"
  echo "certs-init: certificado $name ($san)"
}

# La llave de cada servidor pertenece al usuario con el que corre ese contenedor.
issue waf      "DNS:localhost,IP:127.0.0.1,DNS:waf"  101:101    # nginx (ModSecurity) corre como uid 101
issue traefik  "DNS:traefik,DNS:localhost"           0:0        # Traefik corre como root
issue keycloak "DNS:keycloak"                        1000:1000  # Keycloak corre como uid 1000
issue nats     "DNS:nats"                            0:0        # nats-server corre como root
issue postgres "DNS:postgres"                        70:70      # postgres (alpine) corre como uid 70

# La llave de la CA no la necesita ningún servicio: se borra para que nadie pueda emitir certificados.
rm -f ca.key ca.srl
chmod 644 ca.crt
echo "certs-init: listo"
