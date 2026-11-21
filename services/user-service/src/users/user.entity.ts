import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type Role = 'admin' | 'analyst' | 'reporter';

/**
 * Perfil local de cada usuario que inició sesión. Las CREDENCIALES ya no están aquí:
 * viven en Keycloak (servidor de identidad). Este servicio solo guarda quién usa el sistema.
 */
@Entity('users')
export class User {
  @PrimaryColumn({ length: 40 })
  username: string;

  @Column({ length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  role: Role;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt: Date;
}
