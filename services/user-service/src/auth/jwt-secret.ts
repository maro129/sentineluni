// El secreto del JWT se recibe por variable de entorno (nunca fijo en el código).
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET ?? '';
  if (secret.length < 32) {
    throw new Error('JWT_SECRET debe definirse y tener al menos 32 caracteres (ver .env.example)');
  }
  return secret;
}
