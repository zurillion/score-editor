import { useEffect, useState } from 'react';
import { PieceSummary, StoredPiece, getPiece, listPieces, playUrl } from '../api';
import { MiniScore } from './MiniScore';
import { setPageTitle } from '../pageTitle';

interface Entry extends PieceSummary {
  piece: StoredPiece | null; // full data, loaded lazily for the preview
}

/**
 * Public library (#/libreria): the pieces flagged «Nella libreria pubblica»
 * in the admin page, browsable by anyone with the link. Read-only cards —
 * preview (click = play), title, updated date, BPM, Prova and Condividi —
 * plus the real-time search box.
 */
export function LibraryPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    setPageTitle('Libreria brani');
  }, []);

  useEffect(() => {
    let alive = true;
    listPieces()
      .then((summaries) => {
        if (!alive) return;
        const pub = summaries.filter((s) => s.inLibrary);
        setEntries(pub.map((s) => ({ ...s, piece: null })));
        pub.forEach((s) => {
          getPiece(s.id)
            .then((p) => alive && setEntries((cur) => cur?.map((e) => (e.id === s.id ? { ...e, piece: p } : e)) ?? cur))
            .catch(() => {});
        });
      })
      .catch(() => alive && setError('Impossibile caricare la libreria.'));
    return () => {
      alive = false;
    };
  }, []);

  const needle = query.trim().toLowerCase();
  const filtered = (entries ?? []).filter((e) => !needle || e.title.toLowerCase().includes(needle));

  const openPlay = (id: string) => {
    location.hash = `#/play/${id}`;
  };

  async function copyLink(entry: Entry) {
    const url = playUrl(entry.id);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId((cur) => (cur === entry.id ? null : cur)), 1800);
    } catch {
      window.prompt('Copia il link manualmente:', url);
    }
  }

  return (
    <div className="admin-page library-page">
      <header className="app-header">
        <h1>Score Composer</h1>
        <span className="subtitle">libreria brani</span>
        <a className="admin-link" href="#/">← Editor</a>
      </header>

      {entries && entries.length > 0 && (
        <div className="admin-search">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 Cerca un brano per nome…"
            aria-label="Cerca brani"
          />
          {query && (
            <span className="admin-search-count">
              {filtered.length} su {entries.length}
            </span>
          )}
        </div>
      )}

      {error && <div className="page-message">{error}</div>}
      {!error && !entries && <div className="page-message">Caricamento…</div>}
      {entries && entries.length === 0 && <div className="page-message">La libreria è ancora vuota.</div>}
      {entries && entries.length > 0 && filtered.length === 0 && <div className="page-message">Nessun brano corrisponde alla ricerca.</div>}

      <div className="piece-list">
        {filtered.map((entry) => (
          <div className="piece-card" key={entry.id}>
            <div
              className="piece-preview clickable"
              onClick={() => openPlay(entry.id)}
              title="Ascolta il brano"
              role="link"
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && openPlay(entry.id)}
            >
              {entry.piece ? <MiniScore score={entry.piece.score} /> : <div className="preview-placeholder">…</div>}
            </div>
            <div className="piece-info">
              <div className="piece-title">{entry.title}</div>
              {entry.piece?.updatedAt && (
                <div className="piece-meta">agg. {new Date(entry.piece.updatedAt).toLocaleDateString()} · {entry.piece.bpm} BPM</div>
              )}
            </div>
            <div className="piece-buttons">
              <a className="btn-link" href={`#/play/${entry.id}`} title="Ascolta il brano">
                ▶ Prova
              </a>
              <button onClick={() => copyLink(entry)} title="Copia il link alla versione solo ascolto">
                {copiedId === entry.id ? '✓ Copiato' : '🔗 Condividi'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
