// src/works/works.module.ts
import { Module } from '@nestjs/common';
import { WorksController } from './works.controller';
import { WorksService } from './works.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [WorksController],
  providers: [WorksService],
})
export class WorksModule {}

