// Piece storage API on Netlify Blobs.
//
//   GET    /api/pieces        -> { pieces: [{ id, title }] }        (public)
//   GET    /api/pieces/:id    -> { id, title, bpm, score, ... }     (public)
//   GET    /api/auth          -> 204 / 401                          (password check)
//   POST   /api/pieces        -> { id }        create               (admin)
//   PUT    /api/pieces        -> 204           reorder {order:[id]} (admin)
//   PUT    /api/pieces/:id    -> 204           rename/update        (admin)
//   DELETE /api/pieces/:id    -> 204                                (admin)
//
// Admin calls carry the password in the `x-admin-key` header and are checked
// against the ADMIN_PASSWORD environment variable.
import { getStore } from '@netlify/blobs';
import { createHash, timingSafeEqual } from 'node:crypto';

export const config = { path: '/api/*' };

interface IndexEntry {
  id: string;
  title: string;
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

async function readIndex(): Promise<IndexEntry[]> {
  return ((await store().get('index', { type: 'json' })) as IndexEntry[] | null) ?? [];
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
  if (resource !== 'pieces' || parts.length > 3) return fail(404, 'not found');

  if (req.method === 'GET') {
    if (!id) return json({ pieces: await readIndex() });
    const piece = await store().get(`piece/${id}`, { type: 'json' });
    return piece ? json(piece) : fail(404, 'piece not found');
  }

  if (!authorized(req)) return fail(401, 'unauthorized');

  if (req.method === 'POST' && !id) {
    const body = await req.json().catch(() => null);
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title || typeof body.bpm !== 'number' || !validScore(body.score)) return fail(400, 'invalid piece');
    const newId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    await store().setJSON(`piece/${newId}`, { id: newId, title, bpm: body.bpm, score: body.score, updatedAt: new Date().toISOString() });
    const index = await readIndex();
    index.push({ id: newId, title });
    await store().setJSON('index', index);
    return json({ id: newId }, 201);
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
    await store().setJSON(`piece/${id}`, { ...cur, title, bpm, score, updatedAt: new Date().toISOString() });
    if (title !== cur.title) {
      const index = await readIndex();
      await store().setJSON('index', index.map((e) => (e.id === id ? { ...e, title } : e)));
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
