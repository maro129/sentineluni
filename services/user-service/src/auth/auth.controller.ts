import { Body, Controller, Get, Headers, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** POST /api/auth/login (público) → { token, user } */
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.username, dto.password);
  }

  /**
   * GET /auth/verify — lo llama el API Gateway (Traefik forwardAuth) en CADA petición protegida.
   * 200 + cabeceras X-User/X-Role → Traefik las copia a la petición y la deja pasar.
   * 401 → Traefik corta la petición. No está publicado hacia afuera.
   */
  @Get('verify')
  async verify(@Headers('authorization') authorization: string | undefined, @Res({ passthrough: true }) res: Response) {
    const payload = await this.auth.verify(authorization);
    res.setHeader('X-User', payload.sub);
    res.setHeader('X-Role', payload.role);
    res.setHeader('X-User-Name', encodeURIComponent(payload.name));
    return { ok: true };
  }
}
