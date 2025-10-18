// src/works/works.service.spec.ts
import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorksService } from './works.service';
import { SupabaseService } from '../auth/supabase.service';

// ===== Helpers: pretty print & fixed date =====
const isoNow = '2025-10-18T10:00:00.000Z';
const pp = (v: any) => require('node:util').inspect(v, { colors: true, depth: null });

beforeAll(() => {
  jest.useFakeTimers().setSystemTime(new Date(isoNow));
});
afterAll(() => jest.useRealTimers());

// ===== Minimal DTO type for convenience =====
type CreateWorkDto = {
  title: string;
  description?: string | null;
  status?: 'draft' | 'published';
  tagIds?: string[];
  newTags?: string[];
  images?: { dataUrl: string; alttext?: string }[];
};

// ===== Mock factory for a chainable Supabase client =====
function makeSupaClientMock(behavior: any = {}) {
  let currentTable = '';

  const api = {
    from: jest.fn((tbl: string) => {
      currentTable = tbl;

      // ----- behavior selector -----
      const bInsert = behavior[tbl]?.insert || {};
      const bSelect = behavior[tbl]?.select || {};

      // ----- insert chain: .insert().select().single() -----
      const insert = jest.fn((payload: any) => {
        // helper คืน row ที่จะใช้ใน select/single
        const row =
          typeof bInsert.data === 'function'
            ? bInsert.data(payload)
            : (bInsert.data ?? {});

        // mock select() ที่ตามหลัง insert()
        const afterSelect = {
          single: jest.fn(() => {
            if (bInsert.error) return { data: null, error: bInsert.error };
            return { data: row, error: null };
          }),
        };

        return {
          select: jest.fn(() => afterSelect),
          // เผื่อบาง lib เรียก .single() ตรง ๆ หลัง insert (ไม่ผ่าน select)
          single: jest.fn(() => {
            if (bInsert.error) return { data: null, error: bInsert.error };
            return { data: row, error: null };
          }),
        };
      });

      // ----- select chain: .select().eq().in().order().single() | await select -----
      const select = jest.fn((_fields?: string) => {
        const chain: any = {
          eq: jest.fn(() => chain),
          in: jest.fn(() => chain),
          ilike: jest.fn(() => chain),
          order: jest.fn(() => chain),
          single: jest.fn(() => {
            if (bSelect.error) return { data: null, error: bSelect.error };
            return { data: bSelect.single ?? null, error: null };
          }),
        };

        // รองรับรูปแบบ `const { data, error } = await query;`
        chain.then = (resolve: any) => {
          if (bSelect.error) return resolve({ data: null, error: bSelect.error });
          return resolve({ data: bSelect.list ?? [], error: null });
        };

        return chain;
      });

      return { insert, select };
    }),

    storage: {
      from: jest.fn((bucket: string) => {
        const sb = behavior.storage?.[bucket] || {};
        return {
          upload: jest.fn(async (filename: string, buf: Buffer, opt: any) => {
            if (sb.uploadError) return { data: null, error: sb.uploadError };
            return { data: { path: filename }, error: null };
          }),
          getPublicUrl: jest.fn((key: string) => {
            const base = sb.publicBase || 'https://example.supabase.co/storage/v1/object/public/media/';
            return { data: { publicUrl: base + key } };
          }),
          createSignedUrl: jest.fn(async (key: string) => {
            const url = (sb.signedBase || 'https://signed.example/') + key + '?token=stub';
            return { data: { signedUrl: url }, error: null };
          }),
        };
      }),
    },
  };

  return api;
}


// ===== Create service with mocked dependencies =====
function makeServiceWithMocks(clientBehavior: any, worksTable = 'Work') {
  const supaClient = makeSupaClientMock(clientBehavior);
  const supaSvc = { getAdminClient: () => supaClient } as unknown as SupabaseService;

  const cfg = {
    get: (k: string) => (k === 'WORKS_TABLE' ? worksTable : undefined),
  } as unknown as ConfigService;

  const svc = new WorksService(supaSvc, cfg);
  // avoid real HTTP in signed url helper to keep deterministic
  jest.spyOn<any, any>(svc as any, 'signedMediaUrl').mockImplementation(async (p: string) => p);
  return { svc, supaClient };
}

// ====== TESTS ======
describe('WorksService.create (unit with visible logs)', () => {
  it('A) creates draft work (no tags, no images) and returns row', async () => {
    const behavior = {
      Work: {
        insert: {
          data: (payload: any) => ({ workId: 'w1', ...payload }),
        },
      },
    };
    const { svc } = makeServiceWithMocks(behavior);

    const dto: CreateWorkDto = { title: 'My First Work', description: 'desc' };
    const result = await svc.create('u1', dto);

    console.table([{ step: 'result', workId: (result as any).workId, title: (result as any).title, status: (result as any).status }]);

    expect((result as any).workId).toBe('w1');
    expect((result as any).status).toBe('draft');
    expect((result as any).authorId).toBe('u1');
    expect((result as any).created_at).toBe(isoNow);
  });

  it('B) creates work with newTags + tagIds → links all tags', async () => {
    const behavior = {
      Work: {
        insert: { data: { workId: 'w2' } },
      },
      // insert Tag (ignore duplicates) → we won’t error
      Tag: {
        insert: { data: [{ tagId: 't_new1', name: 'ml' }, { tagId: 't_new2', name: 'iot' }] },
        select: {
          // after .in('name', names) → return ids for those names
          list: [{ tagId: 't1', name: 'ml' }, { tagId: 't2', name: 'iot' }],
        },
      },
      worktag: {
        insert: { data: [{ ok: true }] },
      },
    };
    const { svc } = makeServiceWithMocks(behavior);

    const dto: CreateWorkDto = {
      title: 'Tagged Work',
      newTags: [' ML ', 'IoT '],
      tagIds: ['t9'],
    };

    const result = await svc.create('u123', dto);
    console.log('[Create w/ tags] ->', pp(result));

    expect((result as any).workId).toBe('w2');
    // เราไม่ได้ assert คำสั่งแทรกลิงก์โดยตรง แต่ถ้าอยากเช็คละเอียด:
    // สามารถ spy ที่ supaClient.from('worktag').insert เองใน makeSupaClientMock เพื่อเก็บ payload ไว้ตรวจ
  });

  it('C) creates work with image (data URL) → uploads + creates Media row', async () => {
    // เลือก dataURL เล็กๆ (png header) เพื่อให้ buffer เล็ก—ทดสอบ logic ได้
    const smallPng = 'data:image/png;base64,iVBORw0KGgo=';

    const behavior = {
      Work: { insert: { data: { workId: 'w3' } } },
      Media: { insert: { data: [{ ok: true }] } },
      worktag: { insert: { data: [] } }, // not used here
      storage: {
        media: {
          publicBase: 'https://pub.example/media/',
        },
      },
    };
    const { svc } = makeServiceWithMocks(behavior);

    const dto: CreateWorkDto = {
      title: 'With Image',
      images: [{ dataUrl: smallPng, alttext: 'thumb' }],
    };

    const result = await svc.create('u55', dto);
    console.log('[Create w/ image] ->', pp(result));

    expect((result as any).workId).toBe('w3');
    // หากต้องการยืนยันว่า storage ถูกเรียก ให้เติม hook เก็บ args ใน makeSupaClientMock แล้ว expect ที่นี่
  });

  it('D) when insert work fails → throws InternalServerErrorException', async () => {
    const behavior = {
      Work: {
        insert: { error: { message: 'insert failed' } },
      },
    };
    const { svc } = makeServiceWithMocks(behavior);

    await expect(
      svc.create('uX', { title: 'Boom' })
    ).rejects.toThrow(InternalServerErrorException);
  });
});
