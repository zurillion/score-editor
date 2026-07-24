// Shareable play link with a REAL path (/p/:id).
//
// Link-preview bots (WhatsApp, Telegram, social) fetch the URL server-side,
// don't execute JavaScript and never even see a #fragment — so the hash route
// (#/play/:id) can only ever preview the app's generic title. This tiny page
// carries the SONG title in <title> and Open Graph tags, then immediately
// forwards human visitors to the SPA player at /#/play/:id.
import { getStore } from '@netlify/blobs';

export const config = { path: '/p/:id' };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export default async (req: Request, context: { params?: Record<string, string> }) => {
  const id = context.params?.id ?? '';
  let song: string | null = null;
  if (/^[a-zA-Z0-9_-]{4,64}$/.test(id)) {
    try {
      const piece = (await getStore({ name: 'score-pieces', consistency: 'strong' }).get(`piece/${id}`, { type: 'json' })) as { title?: string } | null;
      if (piece && typeof piece.title === 'string' && piece.title.trim()) song = piece.title.trim();
    } catch {
      /* store unreachable: the preview falls back to the app title */
    }
  }
  const title = song ? `${esc(song)} · Score Composer` : 'Score Composer · Endecalineo';
  const desc = song ? `Ascolta «${esc(song)}» — partitura e riproduzione, solo ascolto.` : 'Partitura e riproduzione — solo ascolto.';
  const origin = new URL(req.url).origin;
  const target = `/#/play/${encodeURIComponent(id)}`;
  const html = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="${desc}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Score Composer">
<meta property="og:url" content="${origin}/p/${esc(id)}">
<meta name="twitter:card" content="summary">
<meta http-equiv="refresh" content="0; url=${target}">
</head>
<body>
<p>Apro <a href="${target}">${title}</a>…</p>
<script>location.replace(${JSON.stringify(target)});</script>
</body>
</html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
};
