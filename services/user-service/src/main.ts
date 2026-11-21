// USER SERVICE (Backend, NestJS): valida los JWT RS256 de Keycloak para el API Gateway y
// guarda el perfil de los usuarios. Las credenciales y la emisión de tokens están en Keycloak.
import './tracing';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ErrorFilter } from './observability/error.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`escuchando en :${port}`, 'user-service');
}
void bootstrap();
