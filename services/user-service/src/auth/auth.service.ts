import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { keycloakConfig } from '../keycloak/keycloak.config';
import { identityFrom, type Identity, type KeycloakClaims } from '../keycloak/roles';
import { UsersService } from '../users/users.service';

/**
 * Autenticación con KEYCLOAK (servidor de identidad).
 *  - Keycloak emite los tokens firmados con RS256 (llave privada que solo tiene Keycloak).
 *  - Este servicio los valida con la llave PÚBLICA publicada por Keycloak (JWKS), así que
 *    no comparte ningún secreto: aunque alguien lea este código no puede fabricar un token.
 *  - El API Gateway (Traefik forwardAuth) llama a verify() en cada petición protegida.
 */
@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);
  private readonly cfg = keycloakConfig();
  // Las llaves públicas se descargan de Keycloak por HTTPS y quedan en caché (rotación automática).
  private jwks: JWTVerifyGetKey = createRemoteJWKSet(new URL(this.cfg.jwksUrl), { cooldownDuration: 30_000, cacheMaxAge: 600_000 });

  constructor(private readonly users: UsersService) {}

  /** Solo para pruebas: usa un juego de llaves local en lugar del de Keycloak. */
  useKeySet(jwks: JWTVerifyGetKey) {
    this.jwks = jwks;
  }

  /** Verifica firma RS256, emisor, audiencia, expiración, cliente y rol del token de Keycloak. */
  async verify(authorization?: string): Promise<Identity> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Falta el token (Authorization: Bearer <JWT>)');
    let claims: KeycloakClaims;
    try {
      ({ payload: claims } = await jwtVerify<KeycloakClaims>(token, this.jwks, {
        algorithms: ['RS256'],
        issuer: this.cfg.issuer,
        audience: this.cfg.audience,
        clockTolerance: 5,
      }));
    } catch (err) {
      this.log.debug(`token rechazado: ${(err as Error).message}`);
      throw new UnauthorizedException('Token inválido o expirado');
    }
    if (!claims.azp || !this.cfg.allowedClients.includes(claims.azp)) {
      throw new UnauthorizedException('Token emitido para un cliente no autorizado');
    }
    const identity = identityFrom(claims);
    if (!identity) throw new UnauthorizedException('El usuario no tiene un rol de SentinelUNI');
    await this.users.remember(identity);
    return identity;
  }

  /**
   * POST /api/auth/login (app móvil y pruebas con curl): pide el token a Keycloak con
   * usuario y contraseña (Direct Access Grant del cliente sentinel-mobile). La web NO usa
   * esto: inicia sesión en la pantalla de Keycloak (Authorization Code + PKCE).
   */
  async login(username: string, password: string) {
    const body = new URLSearchParams({ grant_type: 'password', client_id: this.cfg.loginClient, username, password, scope: 'openid' });
    let res: Response;
    try {
      res = await fetch(this.cfg.tokenUrl, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    } catch (err) {
      this.log.error(`Keycloak no responde: ${(err as Error).message}`);
      throw new ServiceUnavailableException('El servidor de identidad (Keycloak) no está disponible');
    }
    if (res.status === 400 || res.status === 401) throw new UnauthorizedException('Usuario o contraseña incorrectos');
    if (!res.ok) throw new ServiceUnavailableException(`Keycloak respondió ${res.status}`);
    const { access_token: token } = (await res.json()) as { access_token: string };
    const user = await this.verify(`Bearer ${token}`);
    return { token, user: { username: user.sub, name: user.name, role: user.role } };
  }
}
