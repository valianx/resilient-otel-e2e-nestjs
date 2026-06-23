import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

/** Manual run target (the e2e suite boots the app itself via @nestjs/testing). */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks(); // lets the observability lifecycle flush on SIGTERM
  await app.listen(3000);
}
void bootstrap();
