import { JwtService } from '@nestjs/jwt';
import { hashPassword, verifyPassword } from '../users/password';
import { AuthService } from './auth.service';

const jwt = new JwtService({
  secret: 'x'.repeat(32),
  signOptions: { algorithm: 'HS256', expiresIn: '2h', issuer: 'sentineluni', audience: 'sentineluni-api' },
  verifyOptions: { algorithms: ['HS256'], issuer: 'sentineluni', audience: 'sentineluni-api' },
});
const users = { findByUsername: async (u: string) => (u === 'analista' ? { username: 'analista', name: 'Analista SOC', role: 'analyst', passwordHash: hashPassword('analista123') } : null) };
const service = new AuthService(users as never, jwt);

describe('AuthService', () => {
  it('hashea y verifica contraseñas con scrypt', () => {
    const h = hashPassword('secreto');
    expect(verifyPassword('secreto', h)).toBe(true);
    expect(verifyPassword('otro', h)).toBe(false);
  });

  it('emite un JWT que luego verifica', async () => {
    const { token, user } = await service.login('analista', 'analista123');
    expect(user.role).toBe('analyst');
    await expect(service.verify(`Bearer ${token}`)).resolves.toMatchObject({ sub: 'analista', role: 'analyst' });
  });

  it('rechaza contraseña incorrecta, falta de token y token de otro emisor', async () => {
    await expect(service.login('analista', 'mal')).rejects.toThrow('incorrectos');
    await expect(service.verify(undefined)).rejects.toThrow('Falta el token');
    const forged = new JwtService({ secret: 'y'.repeat(32) }).sign({ sub: 'hacker', role: 'admin' });
    await expect(service.verify(`Bearer ${forged}`)).rejects.toThrow('inválido');
  });
});
