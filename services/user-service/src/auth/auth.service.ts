import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verifyPassword } from '../users/password';
import { Role } from '../users/user.entity';
import { UsersService } from '../users/users.service';

export interface TokenPayload {
  sub: string;
  role: Role;
  name: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly users: UsersService, private readonly jwt: JwtService) {}

  async login(username: string, password: string) {
    const user = await this.users.findByUsername(username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }
    const payload: TokenPayload = { sub: user.username, role: user.role, name: user.name };
    return { token: await this.jwt.signAsync(payload), user: { username: user.username, name: user.name, role: user.role } };
  }

  /** Verifica firma, algoritmo, emisor, audiencia y expiración del JWT. */
  async verify(authorization?: string): Promise<TokenPayload> {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Falta el token (Authorization: Bearer <JWT>)');
    try {
      return await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }
}
