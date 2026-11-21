# SentinelUNI móvil (React Native + Expo)

Cliente móvil que consume **el mismo API Gateway** que la web (mismas rutas, mismo JWT).

```bash
cd mobile
npm install
EXPO_PUBLIC_API_URL=https://<IP-de-tu-PC> npx expo start   # escanea el QR con Expo Go
```

- En el celular no sirve `localhost`: usa la IP de tu PC en la misma red Wi-Fi.
- El certificado autofirmado de Traefik no es aceptado por el celular. Para la demo usa
  un certificado de confianza (mkcert instalado también en el celular) o un túnel HTTPS
  (por ejemplo `cloudflared tunnel --url https://localhost --no-tls-verify`).
- El token se guarda cifrado con `expo-secure-store`.
