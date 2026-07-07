// Piece storage API on Netlify Blobs.
//
//   GET    /api/pieces        -> { pieces: [{ id, title, inMenu }] } (public)
//   GET    /api/pieces/:id    -> { id, title, bpm, score, ... }      (public)
//   GET    /api/auth          -> 204 / 401                           (password check)
//   POST   /api/pieces        -> { id }        create                (admin)
//   PUT    /api/pieces        -> 204           reorder {order:[id]}  (admin)
//   PUT    /api/pieces/:id    -> 204           rename/update/inMenu  (admin)
//   DELETE /api/pieces/:id    -> 204                                 (admin)
//   PUT    /api/library       -> { count }     replace the whole
//                                library {pieces:[...]}, keeping the
//                                provided ids so play links survive   (admin)
//
// Admin calls carry the password in the `x-admin-key` header and are checked
// against the ADMIN_PASSWORD environment variable.
//
// On the very first list read (no index blob yet) the store is seeded with
// the built-in example pieces, so the list starts populated and the editor
// menu is fully data-driven.
import { getStore } from '@netlify/blobs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { LIBRARY } from '../../src/music/library';

export const config = { path: '/api/*' };

interface IndexEntry {
  id: string;
  title: string;
  inMenu: boolean; // shown in the editor's Libreria dropdown
}

// strong consistency: the admin page reads its own writes right away
const store = () => getStore({ name: 'score-pieces', consistency: 'strong' });

function authorized(req: Request): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false; // unset password = admin API disabled
  const got = req.headers.get('x-admin-key') ?? '';
  // hash both sides so the comparison is constant-time on equal-length buffers
  const a = createHash('sha256').update(got).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const fail = (status: number, error: string) => json({ error }, status);
const done = () => new Response(null, { status: 204 });

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

/**
 * The index, seeding the built-in examples on the very first read. A `null`
 * index means the store was never initialised (an emptied list is `[]` and is
 * left alone). Entries from before the inMenu flag existed count as shown.
 */
async function readIndex(): Promise<IndexEntry[]> {
  const raw = (await store().get('index', { type: 'json' })) as Partial<IndexEntry>[] | null;
  if (raw) return raw.map((e) => ({ id: e.id!, title: e.title!, inMenu: e.inMenu !== false }));
  const index: IndexEntry[] = [];
  for (const piece of LIBRARY) {
    const id = newId();
    const title = `${piece.title} · ${piece.subtitle}`;
    await store().setJSON(`piece/${id}`, { id, title, bpm: piece.bpm, score: piece.score, updatedAt: new Date().toISOString() });
    index.push({ id, title, inMenu: true });
  }
  await store().setJSON('index', index);
  return index;
}

const validScore = (score: unknown): boolean =>
  !!score && typeof score === 'object' && Array.isArray((score as { measures?: unknown }).measures);

export default async (req: Request) => {
  const parts = new URL(req.url).pathname.split('/').filter(Boolean); // ['api', resource, id?]
  const resource = parts[1];
  const id = parts[2];

  if (resource === 'auth' && req.method === 'GET') {
    return authorized(req) ? done() : fail(401, 'unauthorized');
  }
  if ((resource !== 'pieces' && resource !== 'library') || parts.length > 3) return fail(404, 'not found');

  if (req.method === 'GET' && resource === 'pieces') {
    if (!id) return json({ pieces: await readIndex() });
    const piece = await store().get(`piece/${id}`, { type: 'json' });
    return piece ? json(piece) : fail(404, 'piece not found');
  }

  if (!authorized(req)) return fail(401, 'unauthorized');

  if (resource === 'library') {
    if (req.method !== 'PUT' || id) return fail(405, 'method not allowed');
    // full restore: replace every piece and the index with the given library
    const body = await req.json().catch(() => null);
    const list: unknown[] = Array.isArray(body?.pieces) ? body.pieces : null!;
    if (!list) return fail(400, 'invalid library');
    const used = new Set<string>();
    const incoming: { id: string; title: string; inMenu: boolean; bpm: number; score: unknown; updatedAt: string }[] = [];
    for (const raw of list as Record<string, unknown>[]) {
      const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
      if (!title || typeof raw.bpm !== 'number' || !validScore(raw.score)) return fail(400, `invalid piece: "${title || '?'}"`);
      // keep the exported id (play links survive the restore); regenerate if unusable
      let pid = typeof raw.id === 'string' && /^[a-zA-Z0-9_-]{4,64}$/.test(raw.id) ? raw.id : newId();
      while (used.has(pid)) pid = newId();
      used.add(pid);
      incoming.push({
        id: pid,
        title,
        inMenu: raw.inMenu !== false,
        bpm: raw.bpm,
        score: raw.score,
        ...(raw.playback && typeof raw.playback === 'object' ? { playback: raw.playback } : {}),
        updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
      });
    }
    // read the raw index (no example seeding on a virgin store: we're replacing it anyway)
    const current = ((await store().get('index', { type: 'json' })) as IndexEntry[] | null) ?? [];
    for (const e of current) if (!used.has(e.id)) await store().delete(`piece/${e.id}`);
    for (const p of incoming) await store().setJSON(`piece/${p.id}`, p);
    await store().setJSON('index', incoming.map((p) => ({ id: p.id, title: p.title, inMenu: p.inMenu })));
    return json({ count: incoming.length });
  }

  if (req.method === 'POST' && !id) {
    const body = await req.json().catch(() => null);
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title || typeof body.bpm !== 'number' || !validScore(body.score)) return fail(400, 'invalid piece');
    const index = await readIndex(); // before the piece write: may seed the examples first
    const pieceId = newId();
    const playback = body.playback && typeof body.playback === 'object' ? { playback: body.playback } : {};
    await store().setJSON(`piece/${pieceId}`, { id: pieceId, title, bpm: body.bpm, score: body.score, ...playback, updatedAt: new Date().toISOString() });
    index.push({ id: pieceId, title, inMenu: body.inMenu !== false });
    await store().setJSON('index', index);
    return json({ id: pieceId }, 201);
  }

  if (req.method === 'PUT' && !id) {
    // reorder: the new order must be a permutation of the current ids
    const body = await req.json().catch(() => null);
    const order: unknown = body?.order;
    if (!Array.isArray(order)) return fail(400, 'invalid order');
    const index = await readIndex();
    const byId = new Map(index.map((e) => [e.id, e]));
    if (order.length !== index.length || new Set(order).size !== order.length) return fail(400, 'order must be a permutation');
    const next: IndexEntry[] = [];
    for (const oid of order) {
      const e = byId.get(String(oid));
      if (!e) return fail(400, `unknown id: ${oid}`);
      next.push(e);
    }
    await store().setJSON('index', next);
    return done();
  }

  if (req.method === 'PUT' && id) {
    const body = await req.json().catch(() => null);
    if (!body) return fail(400, 'invalid body');
    const cur = (await store().get(`piece/${id}`, { type: 'json' })) as Record<string, unknown> | null;
    if (!cur) return fail(404, 'piece not found');
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : (cur.title as string);
    const bpm = typeof body.bpm === 'number' ? body.bpm : cur.bpm;
    const score = validScore(body.score) ? body.score : cur.score;
    const playback = body.playback && typeof body.playback === 'object' ? body.playback : cur.playback;
    const contentChanged = title !== cur.title || bpm !== cur.bpm || score !== cur.score || playback !== cur.playback;
    if (contentChanged) {
      await store().setJSON(`piece/${id}`, { ...cur, title, bpm, score, ...(playback !== undefined ? { playback } : {}), updatedAt: new Date().toISOString() });
    }
    if (title !== cur.title || typeof body.inMenu === 'boolean') {
      const index = await readIndex();
      await store().setJSON(
        'index',
        index.map((e) => (e.id === id ? { ...e, title, ...(typeof body.inMenu === 'boolean' ? { inMenu: body.inMenu } : {}) } : e)),
      );
    }
    return done();
  }

  if (req.method === 'DELETE' && id) {
    await store().delete(`piece/${id}`);
    const index = await readIndex();
    await store().setJSON('index', index.filter((e) => e.id !== id));
    return done();
  }

  return fail(405, 'method not allowed');
};
