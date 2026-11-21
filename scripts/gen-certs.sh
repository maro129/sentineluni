#!/usr/bin/env sh
# Genera un certificado HTTPS para localhost y lo registra en Traefik.
# - Con mkcert (recomendado): el navegador lo acepta sin advertencias y la PWA puede
#   registrar su service worker (los navegadores no lo permiten con certificados no confiables).
# - Sin mkcert: certificado autofirmado con openssl (el navegador mostrará una advertencia).
set -e
cd "$(dirname "$0")/.."
mkdir -p gateway/certs
if command -v mkcert >/dev/null 2>&1; then
  mkcert -install
  mkcert -cert-file gateway/certs/localhost.pem -key-file gateway/certs/localhost-key.pem localhost 127.0.0.1 ::1
else
  echo "mkcert no está instalado: se genera un certificado autofirmado con openssl"
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    -keyout gateway/certs/localhost-key.pem -out gateway/certs/localhost.pem
fi
cp gateway/tls.yml.example gateway/dynamic/tls.yml
echo "Listo: gateway/certs/localhost.pem (Traefik lo recarga solo)"
