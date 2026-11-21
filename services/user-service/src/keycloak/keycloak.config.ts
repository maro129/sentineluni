// Configuración de Keycloak (servidor de identidad). Todo llega por variables de entorno.
//  - ISSUER: URL pública del realm; es el "iss" que Keycloak pone en cada token.
//  - INTERNAL_URL: cómo llega este servicio a Keycloak por la red interna (HTTPS con la CA interna).
export const keycloakConfig = () => {
  const realm = process.env.KEYCLOAK_REALM ?? 'sentineluni';
  const internal = (process.env.KEYCLOAK_INTERNAL_URL ?? 'https://keycloak:8443/auth').replace(/\/$/, '');
  return {
    issuer: process.env.KEYCLOAK_ISSUER ?? `https://localhost/auth/realms/${realm}`,
    jwksUrl: `${internal}/realms/${realm}/protocol/openid-connect/certs`,
    tokenUrl: `${internal}/realms/${realm}/protocol/openid-connect/token`,
    /** Audiencia obligatoria: el token debe haber sido emitido PARA esta API. */
    audience: process.env.KEYCLOAK_AUDIENCE ?? 'sentineluni-api',
    /** Clientes de Keycloak autorizados a pedir tokens para la API (claim "azp"). */
    allowedClients: (process.env.KEYCLOAK_ALLOWED_CLIENTS ?? 'sentinel-web,sentinel-mobile').split(','),
    /** Cliente público con "Direct Access Grants" usado por POST /api/auth/login (app móvil y pruebas). */
    loginClient: process.env.KEYCLOAK_LOGIN_CLIENT ?? 'sentinel-mobile',
  };
};
