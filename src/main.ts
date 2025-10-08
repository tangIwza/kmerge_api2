import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import 'dotenv/config';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ถ้าเคยมี global prefix ให้รู้ว่า route จะย้ายเป็น /api/auth/login
  // app.setGlobalPrefix('api');

  await app.listen(process.env.PORT ?? 3000);
  console.log('API on http://localhost:3000');
  app.use(cookieParser());
  app.enableCors({ origin: 'http://localhost:5173', credentials: true });
}
bootstrap();
