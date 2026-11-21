import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export type Role = 'admin' | 'analyst' | 'reporter';

@Entity('users')
export class User {
  @PrimaryColumn({ length: 40 })
  username: string;

  @Column({ length: 80 })
  name: string;

  @Column({ type: 'varchar', length: 20 })
  role: Role;

  /** salt:hash con scrypt; nunca la contraseña en texto plano */
  @Column({ name: 'password_hash', length: 200 })
  passwordHash: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
