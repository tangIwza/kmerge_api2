// src/works/works.service.ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../auth/supabase.service';
import { CreateWorkDto } from './dto/create-work.dto';

@Injectable()
export class WorksService {
  private table: string;

  constructor(private supa: SupabaseService, cfg: ConfigService) {
    this.table = cfg.get<string>('WORKS_TABLE') || 'Work';
  }

  async create(userId: string, dto: CreateWorkDto) {
    const supa = this.supa.getAdminClient();

    const now = new Date().toISOString();
    const status = dto.status || 'draft';

    const payload: Record<string, any> = {
      authorId: userId,
      title: dto.title,
      description: dto.description ?? null,
      status,
      created_at: now,
      updatedAt: now,
      publishedAt: status === 'published' ? now : null,
      // initialize counters if exist
      views: 0,
      likes: 0,
    };

    const { data: work, error } = await supa
      .from(this.table)
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }
    const workId: string = (work as any).workId ?? (work as any).id;

    // Create new tags if provided, then link all tags
    let finalTagIds: string[] = [];
    if (dto.newTags && dto.newTags.length > 0) {
      const names = dto.newTags
        .map((n) => n?.trim())
        .filter((n): n is string => !!n);
      if (names.length) {
        // Insert ignoring duplicates by name
        const { data: created, error: createErr } = await supa
          .from('Tag')
          .insert(names.map((name) => ({ name })))
          .select();
        if (createErr && !createErr.message.includes('duplicate')) {
          throw new InternalServerErrorException('Failed to create tags: ' + createErr.message);
        }
        // Fetch ids for given names
        const { data: dbTags, error: fetchErr } = await supa
          .from('Tag')
          .select('tagId, name')
          .in('name', names);
        if (fetchErr) {
          throw new InternalServerErrorException('Failed to fetch created tags: ' + fetchErr.message);
        }
        finalTagIds.push(...(dbTags || []).map((t: any) => t.tagId));
      }
    }
    if (dto.tagIds && dto.tagIds.length > 0) {
      finalTagIds.push(...dto.tagIds);
    }
    finalTagIds = Array.from(new Set(finalTagIds));
    if (finalTagIds.length > 0) {
      const linkRows = finalTagIds.map((tagId) => ({ tagId, workId }));
      const { error: tagErr } = await supa.from('worktag').insert(linkRows);
      if (tagErr) {
        throw new InternalServerErrorException('Failed to link tags: ' + tagErr.message);
      }
    }

    // Upload images if provided; first becomes thumbnail implicitly by order (frontend can display first)
    if (dto.images && dto.images.length > 0) {
      for (let i = 0; i < dto.images.length; i++) {
        const img = dto.images[i];
        try {
          const { buffer, mime, sizeMb } = this.parseDataUrl(img.dataUrl);
          const filename = `${workId}/${Date.now()}-${i}.${this.extensionFromMime(mime)}`;
          const { error: upErr } = await supa.storage
            .from('media')
            .upload(filename, buffer, { contentType: mime, upsert: true });
          if (upErr) throw upErr;

          const { data: { publicUrl } } = supa.storage.from('media').getPublicUrl(filename);

          const { error: mediaErr } = await supa.from('Media').insert({
            workId,
            fileurl: publicUrl,
            filetype: mime,
            // DB column is int8 (bigint) -> store integer MB
            sizemb: Math.ceil(sizeMb),
            alttext: img.alttext ?? null,
          });
          if (mediaErr) throw mediaErr;
        } catch (e: any) {
          throw new InternalServerErrorException('Failed to upload image: ' + e.message);
        }
      }
    }

    return work;
  }

  // Helpers
  private parseDataUrl(dataUrl: string): { buffer: Buffer; mime: string; sizeMb: number } {
    const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
    if (!match) throw new Error('Invalid data URL');
    const mime = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    const sizeMb = Math.round((buffer.length / (1024 * 1024)) * 100) / 100;
    return { buffer, mime, sizeMb };
  }

  private extensionFromMime(mime: string): string {
    const ext = mime.split('/')[1] || 'bin';
    return ext.includes('+') ? ext.split('+')[0] : ext;
  }

  private async signedMediaUrl(pathOrUrl: string): Promise<string> {
    const supa = this.supa.getAdminClient();
    try {
      // Try to extract storage path from a public URL
      // formats: https://<ref>.supabase.co/storage/v1/object/public/media/<key>
      // or raw key: <key>
      let key = pathOrUrl;
      const m = pathOrUrl.match(/\/storage\/v1\/object\/public\/media\/(.*)$/);
      if (m) key = m[1];
      // create long-lived signed URL (1 year)
      const { data, error } = await supa.storage
        .from('media')
        .createSignedUrl(key, 60 * 60 * 24 * 365);
      if (error || !data?.signedUrl) return pathOrUrl;
      return data.signedUrl;
    } catch {
      return pathOrUrl;
    }
  }

  async listPublished() {
    const supa = this.supa.getAdminClient();

    const { data: works, error } = await supa
      .from(this.table)
      .select('*')
      .eq('status', 'published')
      .order('publishedAt', { ascending: false });
    if (error) throw new InternalServerErrorException(error.message);

    return await this.enrichWorks(works || []);
  }

  async listMine(userId: string) {
    const supa = this.supa.getAdminClient();
    const { data: works, error } = await supa
      .from(this.table)
      .select('*')
      .eq('authorId', userId)
      .order('created_at', { ascending: false });
    if (error) throw new InternalServerErrorException(error.message);
    return await this.enrichWorks(works || []);
  }

  async getOne(id: string) {
    const supa = this.supa.getAdminClient();
    const { data: work, error } = await supa
      .from(this.table)
      .select('*')
      .eq('workId', id)
      .single();
    if (error) throw new InternalServerErrorException(error.message);
    if (!work) return null;

    const [{ data: media }, { data: links }, { data: tags }] = await Promise.all([
      supa.from('Media').select('*').eq('workId', id).order('createdAt'),
      supa.from('worktag').select('workId, tagId').eq('workId', id),
      supa.from('Tag').select('tagId, name'),
    ]);

    const tagNameById = new Map((tags || []).map((t: any) => [t.tagId, t.name]));
    const tagItems = (links || [])
      .map((l: any) => ({ tagId: l.tagId, name: tagNameById.get(l.tagId) }))
      .filter((t) => !!t.name);

    const mediaWithUrl = await Promise.all((media || []).map(async (m: any) => ({
      ...m,
      fileurl: await this.signedMediaUrl(m.fileurl),
    })));

    return {
      ...work,
      media: mediaWithUrl,
      tags: tagItems,
      thumbnail: mediaWithUrl[0]?.fileurl || null,
    };
  }

  async searchTags(q?: string) {
    const supa = this.supa.getAdminClient();
    let query = supa.from('Tag').select('tagId, name').order('name');
    if (q && q.trim()) {
      query = query.ilike('name', `%${q.trim()}%`);
    }
    const { data, error } = await query;
    if (error) throw new InternalServerErrorException(error.message);
    return data || [];
  }

  private async enrichWorks(works: any[]) {
    if (works.length === 0) return [];
    const supa = this.supa.getAdminClient();
    const ids = works.map((w) => w.workId ?? w.id);

    const [{ data: media }, { data: links }, { data: tags }] = await Promise.all([
      supa.from('Media').select('workId, fileurl, createdAt').in('workId', ids).order('createdAt'),
      supa.from('worktag').select('workId, tagId').in('workId', ids),
      supa.from('Tag').select('tagId, name'),
    ]);

    const tagNameById = new Map((tags || []).map((t: any) => [t.tagId, t.name]));
    const firstMediaByWork = new Map<string, any>();
    (media || []).forEach((m: any) => {
      const key = m.workId;
      if (!firstMediaByWork.has(key)) firstMediaByWork.set(key, m);
    });

    const tagsByWork: Record<string, { tagId: string; name: string }[]> = {};
    (links || []).forEach((l: any) => {
      const arr = (tagsByWork[l.workId] ||= []);
      const name = tagNameById.get(l.tagId);
      if (name) arr.push({ tagId: l.tagId, name });
    });

    return Promise.all(works.map(async (w) => {
      const wid = w.workId ?? w.id;
      const thumbRaw = firstMediaByWork.get(wid)?.fileurl || null;
      const thumbnail = thumbRaw ? await this.signedMediaUrl(thumbRaw) : null;
      return {
        ...w,
        thumbnail,
        tags: tagsByWork[wid] || [],
      };
    }));
  }
}
