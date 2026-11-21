import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import { appRole } from '../keycloak/roles';
import { AuthService } from './auth.service';

const ISSUER = 'https://localhost/auth/realms/sentineluni';
const remembered: string[] = [];
const users = { remember: async (i: { sub: string }) => { remembered.push(i.sub); } };

let keycloakKey: KeyLike;
let attackerKey: KeyLike;
let service: AuthService;

/** Firma un token como lo haría Keycloak (RS256). */
const token = (claims: Record<string, unknown>, key = keycloakKey, opts: { iss?: string; aud?: string; exp?: string } = {}) =>
  new SignJWT({ preferred_username: 'analista', name: 'Analista SOC', azp: 'sentinel-web', realm_access: { roles: ['analyst', 'offline_access'] }, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'kc' })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? 'sentineluni-api')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(key);

beforeAll(async () => {
  const kc = await generateKeyPair('RS256');
  keycloakKey = kc.privateKey;
  attackerKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(kc.publicKey)), kid: 'kc', alg: 'RS256' };
  service = new AuthService(users as never);
  service.useKeySet(createLocalJWKSet({ keys: [jwk] }));
});

describe('roles de Keycloak', () => {
  it('elige el rol de más privilegio y descarta roles ajenos', () => {
    expect(appRole(['reporter', 'admin'])).toBe('admin');
    expect(appRole(['offline_access', 'analyst'])).toBe('analyst');
    expect(appRole(['offline_access'])).toBeNull();
  });
});

describe('AuthService.verify (JWT RS256 de Keycloak)', () => {
  it('acepta un token válido y devuelve la identidad para el Gateway', async () => {
    await expect(service.verify(`Bearer ${await token({})}`)).resolves.toEqual({ sub: 'analista', role: 'analyst', name: 'Analista SOC' });
    expect(remembered).toContain('analista');
  });

  it('rechaza falta de token, firma de otra llave, otro emisor, otra audiencia y token expirado', async () => {
    await expect(service.verify(undefined)).rejects.toThrow('Falta el token');
    await expect(service.verify(`Bearer ${await token({}, attackerKey)}`)).rejects.toThrow('inválido');
    await expect(service.verify(`Bearer ${await token({}, keycloakKey, { iss: 'https://evil/realms/x' })}`)).rejects.toThrow('inválido');
    await expect(service.verify(`Bearer ${await token({}, keycloakKey, { aud: 'otra-api' })}`)).rejects.toThrow('inválido');
    await expect(service.verify(`Bearer ${await token({}, keycloakKey, { exp: '-1m' })}`)).rejects.toThrow('inválido');
  });

  it('rechaza tokens de clientes no autorizados o sin rol de SentinelUNI', async () => {
    await expect(service.verify(`Bearer ${await token({ azp: 'otro-cliente' })}`)).rejects.toThrow('cliente no autorizado');
    await expect(service.verify(`Bearer ${await token({ realm_access: { roles: ['offline_access'] } })}`)).rejects.toThrow('rol');
  });

  it('rechaza tokens HS256 aunque digan venir de Keycloak (ataque de confusión de algoritmo)', async () => {
    const hs = await new SignJWT({ preferred_username: 'hacker', azp: 'sentinel-web', realm_access: { roles: ['admin'] } })
      .setProtectedHeader({ alg: 'HS256' }).setIssuer(ISSUER).setAudience('sentineluni-api').setExpirationTime('5m')
      .sign(new TextEncoder().encode('x'.repeat(32)));
    await expect(service.verify(`Bearer ${hs}`)).rejects.toThrow('inválido');
  });
});
