import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { jwtSecret } from './auth/jwt-secret';
import { HealthController } from './observability/health.controller';
import { MetricsController } from './observability/metrics.controller';
import { MetricsInterceptor } from './observability/metrics.interceptor';
import { User } from './users/user.entity';
import { UsersService } from './users/users.service';

@Module({
  imports: [
    // Datos: PostgreSQL propio del servicio (users_db) a través del ORM TypeORM
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://sentinel:sentinel@localhost:5432/users_db',
      entities: [User],
      synchronize: true, // crea/actualiza la tabla; en producción se usarían migraciones
      retryAttempts: 30,
      retryDelay: 2000,
    }),
    TypeOrmModule.forFeature([User]),
    JwtModule.register({
      secret: jwtSecret(),
      signOptions: { algorithm: 'HS256', expiresIn: '2h', issuer: 'sentineluni', audience: 'sentineluni-api' },
      verifyOptions: { algorithms: ['HS256'], issuer: 'sentineluni', audience: 'sentineluni-api' },
    }),
  ],
  controllers: [AuthController, HealthController, MetricsController],
  providers: [AuthService, UsersService, { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
})
export class AppModule {}
