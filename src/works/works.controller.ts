// src/works/works.controller.ts
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CreateWorkDto } from './dto/create-work.dto';
import { WorksService } from './works.service';

@Controller('works')
export class WorksController {
  constructor(private works: WorksService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard)
  async create(@Req() req: Request, @Body() body: CreateWorkDto) {
    const user = (req as any).user;
    return await this.works.create(user.id, body);
  }

  // List published works (homepage)
  @Get()
  async list() {
    return await this.works.listPublished();
  }

  // List current user's works (profile)
  @Get('my')
  @UseGuards(AuthGuard)
  async my(@Req() req: Request) {
    const user = (req as any).user;
    return await this.works.listMine(user.id);
  }

  // Search/list tags
  @Get('meta/tags')
  async tags(@Query('q') q?: string) {
    return await this.works.searchTags(q);
  }

  // Get one work with media + tags
  @Get(':id')
  async getOne(@Param('id') id: string) {
    return await this.works.getOne(id);
  }
}
