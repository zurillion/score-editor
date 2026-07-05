import { MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import { ScoreState } from '../music/types';
import {
  PieceSummary,
  StoredPiece,
  checkAdmin,
  createPiece,
  deletePiece,
  getPiece,
  listPieces,
  playUrl,
  reorderPieces,
  updatePiece,
} from '../api';
import { MiniScore } from './MiniScore';
import type { EditorSnapshot } from '../App';

interface Entry extends PieceSummary {
  piece: StoredPiece | null; // full data, loaded lazily for the preview / export
}

const KEY_STORAGE = 'admin.key';

/**
 * Password-protected list management (#/admin): only the admin can add,
 * rename, reorder, delete, import/export pieces and copy play-only links.
 */
export function AdminPage({ editorRef }: { editorRef: MutableRefObject<EditorSnapshot | null> }) {
  const [key, setKey] = useState<string | null>(() => sessionStorage.getItem(KEY_STORAGE));
  const [authed, setAuthed] = useState<'checking' | 'yes' | 'no'>(key ? 'checking' : 'no');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const showError = (message: string) => setBanner(message);

  const refresh = useCallback(async () => {
    const summaries = await listPieces();
    setEntries(summaries.map((s) => ({ ...s, piece: null })));
    // fetch full pieces in parallel for previews; each row fills in as it arrives
    summaries.forEach((s) => {
      getPiece(s.id)
        .then((p) => setEntries((cur) => cur?.map((e) => (e.id === s.id ? { ...e, piece: p } : e)) ?? cur))
        .catch(() => {});
    });
  }, []);

  // verify a remembered password on mount
  useEffect(() => {
    if (!key) return;
    let alive = true;
    checkAdmin(key).then((ok) => {
      if (!alive) return;
      if (ok) {
        setAuthed('yes');
      } else {
        sessionStorage.removeItem(KEY_STORAGE);
        setKey(null);
        setAuthed('no');
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authed === 'yes') refresh().catch(() => showError('Impossibile caricare la lista dei brani.'));
  }, [authed, refresh]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    const ok = await checkAdmin(password).catch(() => false);
    if (!ok) {
      setLoginError('Password errata (o server non raggiungibile).');
      return;
    }
    sessionStorage.setItem(KEY_STORAGE, password);
    setKey(password);
    setAuthed('yes');
    setPassword('');
  }

  /** Wraps an admin mutation with the busy flag and error reporting. */
  async function run(op: () => Promise<void>) {
    setBusy(true);
    setBanner(null);
    try {
      await op();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Operazione fallita.');
    } finally {
      setBusy(false);
    }
  }

  const snap = editorRef.current;
  const snapSource = snap?.sourceId ? entries?.find((e) => e.id === snap.sourceId) ?? null : null;

  function titleFor(snapName: string): string | null {
    let title = snapName.trim();
    if (!title) {
      const t = window.prompt('Titolo del nuovo brano:', '');
      if (t === null) return null;
      title = t.trim();
    }
    return title || null;
  }

  const addCurrent = (overwrite: boolean) =>
    run(async () => {
      const s = editorRef.current;
      if (!s || !key) return;
      if (overwrite && snapSource) {
        if (!window.confirm(`Aggiornare il brano esistente "${snapSource.title}" con la versione corrente dell'editor?`)) return;
        await updatePiece(key, snapSource.id, { title: s.name.trim() || snapSource.title, bpm: s.bpm, score: s.score });
      } else {
        const title = titleFor(s.name);
        if (!title) return;
        await createPiece(key, { title, bpm: s.bpm, score: s.score });
      }
      await refresh();
    });

  const remove = (entry: Entry) =>
    run(async () => {
      if (!key || !window.confirm(`Eliminare definitivamente "${entry.title}"?`)) return;
      await deletePiece(key, entry.id);
      setEntries((cur) => cur?.filter((e) => e.id !== entry.id) ?? cur);
    });

  const rename = (entry: Entry) =>
    run(async () => {
      if (!key) return;
      const t = window.prompt('Nuovo titolo:', entry.title);
      if (t === null) return;
      const title = t.trim();
      if (!title || title === entry.title) return;
      await updatePiece(key, entry.id, { title });
      setEntries((cur) => cur?.map((e) => (e.id === entry.id ? { ...e, title, piece: e.piece ? { ...e.piece, title } : null } : e)) ?? cur);
    });

  const move = (entry: Entry, delta: -1 | 1) =>
    run(async () => {
      if (!key || !entries) return;
      const i = entries.findIndex((e) => e.id === entry.id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= entries.length) return;
      const next = entries.slice();
      [next[i], next[j]] = [next[j], next[i]];
      await reorderPieces(key, next.map((e) => e.id));
      setEntries(next);
    });

  async function exportJson(entry: Entry) {
    const piece = entry.piece ?? (await getPiece(entry.id).catch(() => null));
    if (!piece) {
      showError('Brano non ancora caricato, riprova tra un attimo.');
      return;
    }
    const data = { format: 'score-composer', version: 1, name: piece.title, bpm: piece.bpm, score: piece.score };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safe = piece.title.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
    a.href = url;
    a.download = `${safe || 'brano'}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const importJson = (file: File) =>
    run(async () => {
      if (!key) return;
      let obj: { name?: unknown; bpm?: unknown; score?: { measures?: unknown; timeSignature?: unknown } } | null = null;
      try {
        obj = JSON.parse(await file.text());
      } catch {
        showError('File non valido (JSON illeggibile).');
        return;
      }
      const score = (obj?.score ?? obj) as ScoreState | undefined;
      if (!score || !Array.isArray(score.measures) || !score.timeSignature) {
        showError('File non valido: non sembra un brano di Score Composer.');
        return;
      }
      const title = titleFor(typeof obj?.name === 'string' ? obj.name : file.name.replace(/\.json$/i, ''));
      if (!title) return;
      await createPiece(key, { title, bpm: typeof obj?.bpm === 'number' ? obj.bpm : 96, score });
      await refresh();
    });

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

  function openInEditor(entry: Entry) {
    // the editor (kept mounted under this page) picks this up on activation
    sessionStorage.setItem('pending.load', entry.id);
    location.hash = '#/';
  }

  if (authed !== 'yes') {
    return (
      <div className="admin-page">
        <header className="app-header">
          <h1>Score Composer</h1>
          <span className="subtitle">gestione brani</span>
          <a className="admin-link" href="#/">← Editor</a>
        </header>
        {authed === 'checking' ? (
          <div className="page-message">Verifica…</div>
        ) : (
          <form className="admin-login" onSubmit={handleLogin}>
            <label>
              Password di amministrazione
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            </label>
            <button type="submit" disabled={!password}>Entra</button>
            {loginError && <div className="login-error">{loginError}</div>}
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="admin-page">
      <header className="app-header">
        <h1>Score Composer</h1>
        <span className="subtitle">gestione brani</span>
        <a className="admin-link" href="#/">← Editor</a>
      </header>

      <div className="admin-actions">
        {snapSource ? (
          <>
            <button disabled={busy} onClick={() => addCurrent(true)} title="Sovrascrive il brano della lista da cui sei partito">
              ⤴ Aggiorna «{snapSource.title}»
            </button>
            <button disabled={busy} onClick={() => addCurrent(false)} title="Aggiunge il brano corrente dell'editor come nuovo elemento">
              + Aggiungi come nuovo
            </button>
          </>
        ) : (
          <button disabled={busy || !snap} onClick={() => addCurrent(false)} title="Aggiunge il brano corrente dell'editor alla lista">
            + Aggiungi il brano corrente
          </button>
        )}
        <button disabled={busy} onClick={() => fileInputRef.current?.click()} title="Importa un brano da un file .json">
          ⤒ Importa JSON
        </button>
        <span className="spacer" />
        <button
          onClick={() => {
            sessionStorage.removeItem(KEY_STORAGE);
            setKey(null);
            setAuthed('no');
          }}
          title="Dimentica la password su questo browser"
        >
          Esci
        </button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importJson(f);
        }}
      />

      {banner && <div className="admin-banner">{banner}</div>}

      {!entries && <div className="page-message">Caricamento…</div>}
      {entries && entries.length === 0 && <div className="page-message">Nessun brano in lista: aggiungi quello corrente o importa un JSON.</div>}

      <div className="piece-list">
        {entries?.map((entry, i) => (
          <div className="piece-card" key={entry.id}>
            <div className="piece-preview">
              {entry.piece ? <MiniScore score={entry.piece.score} /> : <div className="preview-placeholder">…</div>}
            </div>
            <div className="piece-info">
              <div className="piece-title">{entry.title}</div>
              {entry.piece?.updatedAt && (
                <div className="piece-meta">agg. {new Date(entry.piece.updatedAt).toLocaleDateString()} · {entry.piece.bpm} BPM</div>
              )}
            </div>
            <div className="piece-buttons">
              <button disabled={busy || i === 0} onClick={() => move(entry, -1)} title="Sposta su" aria-label="Sposta su">↑</button>
              <button disabled={busy || i === entries.length - 1} onClick={() => move(entry, 1)} title="Sposta giù" aria-label="Sposta giù">↓</button>
              <button onClick={() => openInEditor(entry)} title="Apri nell'editor">✎ Apri</button>
              <button onClick={() => copyLink(entry)} title="Copia il link alla versione solo ascolto">
                {copiedId === entry.id ? '✓ Copiato' : '🔗 Condividi'}
              </button>
              <a className="btn-link" href={playUrl(entry.id)} target="_blank" rel="noreferrer" title="Apri la versione solo ascolto">
                ▶ Prova
              </a>
              <button onClick={() => void exportJson(entry)} title="Scarica il brano come file .json">⤓ JSON</button>
              <button disabled={busy} onClick={() => rename(entry)} title="Rinomina">Rinomina</button>
              <button disabled={busy} className="danger" onClick={() => remove(entry)} title="Elimina dalla lista">Elimina</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
