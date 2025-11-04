import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { json } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Increase JSON body size limit to 10MB
  app.use(json({ limit: '10mb' }));
  app.use(cookieParser());

  app.enableCors({
    origin: [
      'https://k-merge.vercel.app',
      /\.vercel\.app$/
    ],
    credentials: true,
  });

  await app.listen(3000);
}
bootstrap();
