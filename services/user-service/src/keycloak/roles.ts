import type { Role } from '../users/user.entity';

/** Claims de un access token de Keycloak que usa SentinelUNI. */
export interface KeycloakClaims {
  sub?: string;
  preferred_username?: string;
  name?: string;
  azp?: string;
  realm_access?: { roles?: string[] };
}

/** Rol de la aplicación según los roles del realm (si tiene varios, gana el de más privilegio). */
export function appRole(roles: string[] = []): Role | null {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('analyst')) return 'analyst';
  if (roles.includes('reporter')) return 'reporter';
  return null;
}

/** Identidad que el API Gateway pasa a los microservicios (X-User / X-Role / X-User-Name). */
export interface Identity {
  sub: string;
  role: Role;
  name: string;
}

export function identityFrom(claims: KeycloakClaims): Identity | null {
  const role = appRole(claims.realm_access?.roles);
  const username = claims.preferred_username;
  if (!role || !username) return null;
  return { sub: username, role, name: claims.name?.trim() || username };
}
