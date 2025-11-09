// src/works/works.controller.ts
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Delete, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CreateWorkDto } from './dto/create-work.dto';
import { WorksService } from './works.service';
import { UpdateWorkDto } from './dto/update-work.dto';

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

  @Get('saved')
  @UseGuards(AuthGuard)
  async saved(@Req() req: Request) {
    const user = (req as any).user;
    return await this.works.listSaved(user.id);
  }

  // Search/list tags
  @Get('meta/tags')
  async tags(@Query('q') q?: string) {
    return await this.works.searchTags(q);
  }

  @Get('author/:id')
  async byAuthor(@Param('id') id: string) {
    return await this.works.listPublishedByAuthor(id);
  }

  // Get one work with media + tags
  @Get(':id')
  async getOne(@Param('id') id: string) {
    return await this.works.getOne(id);
  }

  // Update a work (owner only)
  @Put(':id')
  @UseGuards(AuthGuard)
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: UpdateWorkDto) {
    const user = (req as any).user;
    return await this.works.update(user.id, id, body);
  }

  @Get(':id/save')
  @UseGuards(AuthGuard)
  async getSave(@Req() req: Request, @Param('id') id: string) {
    const user = (req as any).user;
    return await this.works.getSaveSnapshot(user.id, id);
  }

  @Post(':id/save')
  @UseGuards(AuthGuard)
  async save(@Req() req: Request, @Param('id') id: string) {
    const user = (req as any).user;
    return await this.works.saveWork(user.id, id);
  }

  @Delete(':id/save')
  @UseGuards(AuthGuard)
  async unsave(@Req() req: Request, @Param('id') id: string) {
    const user = (req as any).user;
    return await this.works.unsaveWork(user.id, id);
  }

  // Delete a work (owner only)
  @Delete(':id')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: Request, @Param('id') id: string) {
    const user = (req as any).user;
    await this.works.remove(user.id, id);
  }
}
