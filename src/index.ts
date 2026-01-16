import { NestFactory } from '@nestjs/core';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AppModule } from './app.module';

let app: any;

async function bootstrap() {
  if (!app) {
    app = await NestFactory.create(AppModule);
    await app.init();
  }
  return app;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const app = await bootstrap();
  const instance = app.getHttpAdapter().getInstance();
  return instance(req, res);
}
