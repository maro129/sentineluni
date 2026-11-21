import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Identity } from '../keycloak/roles';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  private readonly log = new Logger(UsersService.name);
  /** Último rol/nombre guardado por usuario: evita escribir en la base en cada petición. */
  private readonly seen = new Map<string, string>();

  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  /** Guarda (o actualiza) el perfil del usuario autenticado por Keycloak en users_db. */
  async remember(identity: Identity) {
    const key = `${identity.role}|${identity.name}`;
    if (this.seen.get(identity.sub) === key) return;
    try {
      await this.users.save(this.users.create({ username: identity.sub, name: identity.name, role: identity.role }));
      this.seen.set(identity.sub, key);
    } catch (err) {
      // La base no debe impedir el acceso: la identidad ya fue validada por Keycloak.
      this.log.warn(`no se pudo guardar el perfil de ${identity.sub}: ${(err as Error).message}`);
    }
  }
}
