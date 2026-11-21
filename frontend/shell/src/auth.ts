// Autenticación con KEYCLOAK (OpenID Connect, Authorization Code + PKCE).
//  1. Si no hay sesión, el navegador va a la pantalla de login de Keycloak (https://localhost/auth/...).
//  2. Keycloak devuelve un código y keycloak-js lo cambia por un access token JWT firmado con RS256.
//  3. El token se guarda en sessionStorage (los microfrontends lo leen con session.token())
//     y se renueva antes de que expire.
// La contraseña nunca pasa por la aplicación: solo la ve Keycloak.
import Keycloak from 'keycloak-js';
import { session, type Role, type User } from '@sentinel/shared';

const keycloak = new Keycloak({
  url: `${window.location.origin}/auth`,
  realm: 'sentineluni',
  clientId: 'sentinel-web',
});

const ROLES: Role[] = ['admin', 'analyst', 'reporter'];

function userFromToken(): User | null {
  const t = keycloak.tokenParsed as { preferred_username?: string; name?: string; realm_access?: { roles?: string[] } } | undefined;
  const role = ROLES.find((r) => t?.realm_access?.roles?.includes(r));
  if (!t?.preferred_username || !role) return null;
  return { username: t.preferred_username, name: t.name || t.preferred_username, role };
}

function saveSession(): User | null {
  const user = userFromToken();
  if (keycloak.token && user) session.save(keycloak.token, user);
  return user;
}

/** Inicia sesión con Keycloak (redirige a su pantalla de login si hace falta) y devuelve el usuario. */
export async function initAuth(): Promise<User | null> {
  await keycloak.init({
    onLoad: 'login-required',
    pkceMethod: 'S256',
    checkLoginIframe: false, // sin iframes: compatible con la CSP frame-ancestors 'none'
  });
  // Renueva el token 60 s antes de que expire (los tokens duran 15 min).
  setInterval(() => {
    keycloak.updateToken(60).then(saveSession).catch(() => void keycloak.login());
  }, 30_000);
  keycloak.onTokenExpired = () => { keycloak.updateToken(30).then(saveSession).catch(() => void keycloak.login()); };
  return saveSession();
}

/** Cierra la sesión en la aplicación y en Keycloak. */
export function logout() {
  session.clear();
  void keycloak.logout({ redirectUri: `${window.location.origin}/` });
}

/** Si un microfrontend recibe 401 (token vencido o revocado), vuelve a pedir el login. */
export function relogin() {
  void keycloak.login();
}
