import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getEnv } from './env';

async function bootstrap(): Promise<void> {
  const env = getEnv();
  const app = await NestFactory.create(AppModule);
  await app.listen(env.PORT);
  new Logger('Bootstrap').log(`Harness Runtime API 기동 — http://localhost:${env.PORT}`);
}

void bootstrap();
