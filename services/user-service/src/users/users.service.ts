import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { hashPassword } from './password';
import { Role, User } from './user.entity';

// Usuarios de prueba. Roles: admin y analyst gestionan incidentes; reporter solo reporta y ve los suyos.
const SEED: Array<{ username: string; name: string; role: Role; password: string }> = [
  { username: 'admin', name: 'Administrador', role: 'admin', password: 'admin123' },
  { username: 'analista', name: 'Analista SOC', role: 'analyst', password: 'analista123' },
  { username: 'usuario', name: 'Usuario UNI', role: 'reporter', password: 'usuario123' },
];

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly log = new Logger(UsersService.name);

  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async onApplicationBootstrap() {
    if ((await this.users.count()) > 0) return;
    await this.users.save(SEED.map(({ password, ...u }) => this.users.create({ ...u, passwordHash: hashPassword(password) })));
    this.log.log(`usuarios de prueba creados: ${SEED.map((u) => u.username).join(', ')}`);
  }

  findByUsername(username: string) {
    return this.users.findOneBy({ username });
  }
}
