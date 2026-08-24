import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getEnv } from './env';

async function bootstrap(): Promise<void> {
  const env = getEnv();
  const app = await NestFactory.create(AppModule);

  // 세션 쿠키를 실어 보내야 하므로 origin을 명시하고 credentials를 켠다.
  app.enableCors({
    origin: env.WEB_ORIGINS,
    credentials: true,
  });

  await app.listen(env.PORT);
  new Logger('Bootstrap').log(`Harness Runtime API 기동 — http://localhost:${env.PORT}`);
}

void bootstrap();
