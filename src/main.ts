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
      'http://localhost:5173',
      'https://k-merge-frontend-dev.vercel.app',
      /\.vercel\.app$/,
    ],
    credentials: true,
  });

  app.setGlobalPrefix('api');

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
