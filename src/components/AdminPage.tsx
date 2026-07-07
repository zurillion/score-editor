import { MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import { ScoreState } from '../music/types';
import {
  LibraryPieceExport,
  PieceSummary,
  StoredPiece,
  checkAdmin,
  createPiece,
  deletePiece,
  getPiece,
  listPieces,
  playUrl,
  reorderPieces,
  replaceLibrary,
  updatePiece,
} from '../api';
import { MiniScore } from './MiniScore';
import { sanitizePlayback } from '../music/playback';
import { ExportFormat, ExportMenuButton } from './ExportMenuButton';
import { exportMusicXML, importMusicXML } from '../music/musicxml';
import type { EditorSnapshot } from '../App';

interface Entry extends PieceSummary {
  piece: StoredPiece | null; // full data, loaded lazily for the preview / export
}

const KEY_STORAGE = 'admin.key';

function downloadFile(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const downloadJson = (filename: string, data: unknown) => downloadFile(filename, JSON.stringify(data, null, 2), 'application/json');

const safeName = (title: string) => title.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();

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
  const libFileInputRef = useRef<HTMLInputElement | null>(null);

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
        await updatePiece(key, snapSource.id, { title: s.name.trim() || snapSource.title, bpm: s.bpm, score: s.score, playback: s.playback });
      } else {
        const title = titleFor(s.name);
        if (!title) return;
        await createPiece(key, { title, bpm: s.bpm, score: s.score, playback: s.playback });
      }
      await refresh();
    });

  const remove = (entry: Entry) =>
    run(async () => {
      if (!key || !window.confirm(`Eliminare definitivamente "${entry.title}"?`)) return;
      await deletePiece(key, entry.id);
      setEntries((cur) => cur?.filter((e) => e.id !== entry.id) ?? cur);
    });

  const toggleMenu = (entry: Entry, inMenu: boolean) =>
    run(async () => {
      if (!key) return;
      await updatePiece(key, entry.id, { inMenu });
      setEntries((cur) => cur?.map((e) => (e.id === entry.id ? { ...e, inMenu } : e)) ?? cur);
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

  async function exportPiece(entry: Entry, format: ExportFormat) {
    const piece = entry.piece ?? (await getPiece(entry.id).catch(() => null));
    if (!piece) {
      showError('Brano non ancora caricato, riprova tra un attimo.');
      return;
    }
    const safe = safeName(piece.title) || 'brano';
    if (format === 'musicxml') {
      downloadFile(`${safe}.musicxml`, exportMusicXML(piece.title, piece.bpm, piece.score), 'application/vnd.recordare.musicxml+xml');
    } else {
      downloadJson(`${safe}.json`, { format: 'score-composer', version: 1, name: piece.title, bpm: piece.bpm, ...(piece.playback ? { playback: piece.playback } : {}), score: piece.score });
    }
  }

  // ---- whole-library backup / restore ----

  const exportLibrary = () =>
    run(async () => {
      if (!entries) return;
      // make sure every piece's full data is in hand (previews load lazily)
      const full = await Promise.all(entries.map(async (e) => e.piece ?? (await getPiece(e.id))));
      const pieces: LibraryPieceExport[] = entries.map((e, i) => ({
        id: e.id, // published id: a restore keeps it, so shared play links stay valid
        title: e.title,
        inMenu: e.inMenu,
        bpm: full[i].bpm,
        score: full[i].score,
        ...(full[i].playback ? { playback: full[i].playback } : {}),
        ...(full[i].updatedAt ? { updatedAt: full[i].updatedAt } : {}),
      }));
      const stamp = new Date().toISOString().slice(0, 10);
      downloadJson(`libreria-score-composer-${stamp}.json`, { format: 'score-composer-library', version: 1, exportedAt: new Date().toISOString(), pieces });
    });

  const importLibrary = (file: File) =>
    run(async () => {
      if (!key) return;
      let obj: { format?: unknown; pieces?: unknown } | null = null;
      try {
        obj = JSON.parse(await file.text());
      } catch {
        showError('File non valido (JSON illeggibile).');
        return;
      }
      if (obj?.format !== 'score-composer-library' || !Array.isArray(obj.pieces)) {
        showError(
          obj?.format === 'score-composer'
            ? 'Questo è il file di un singolo brano: usa "Importa brano".'
            : 'File non valido: non sembra un backup della libreria.',
        );
        return;
      }
      const incoming = obj.pieces as LibraryPieceExport[];
      if (
        !window.confirm(
          `Sostituire l'intera libreria attuale (${entries?.length ?? 0} brani) con quella del file (${incoming.length} brani)?\n` +
            'I brani attuali non inclusi nel backup andranno persi.',
        )
      )
        return;
      await replaceLibrary(key, incoming);
      await refresh();
    });

  const importJson = (file: File) =>
    run(async () => {
      if (!key) return;
      const raw = await file.text();
      const stripExt = (n: string) => n.replace(/\.(json|xml|musicxml)$/i, '');
      // MusicXML (by extension or content) or the app's own JSON
      if (/\.(xml|musicxml)$/i.test(file.name) || raw.trimStart().startsWith('<')) {
        try {
          const imp = importMusicXML(raw);
          const title = titleFor(imp.name || stripExt(file.name));
          if (!title) return;
          await createPiece(key, { title, bpm: imp.bpm ?? 96, score: imp.score });
          await refresh();
        } catch (err) {
          showError(`Impossibile importare il MusicXML: ${err instanceof Error ? err.message : 'file non valido'}.`);
        }
        return;
      }
      let obj: { name?: unknown; bpm?: unknown; score?: { measures?: unknown; timeSignature?: unknown } } | null = null;
      try {
        obj = JSON.parse(raw);
      } catch {
        showError('File non valido (JSON illeggibile).');
        return;
      }
      const score = (obj?.score ?? obj) as ScoreState | undefined;
      if (!score || !Array.isArray(score.measures) || !score.timeSignature) {
        showError('File non valido: non sembra un brano di Score Composer.');
        return;
      }
      const title = titleFor(typeof obj?.name === 'string' ? obj.name : stripExt(file.name));
      if (!title) return;
      const playback = sanitizePlayback((obj as { playback?: unknown })?.playback) ?? undefined;
      await createPiece(key, { title, bpm: typeof obj?.bpm === 'number' ? obj.bpm : 96, score, ...(playback ? { playback } : {}) });
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
        <button disabled={busy} onClick={() => fileInputRef.current?.click()} title="Importa un brano da un file .json o MusicXML (.musicxml / .xml)">
          ⤒ Importa brano
        </button>
        <button disabled={busy || !entries} onClick={() => void exportLibrary()} title="Scarica un backup dell'intera libreria (brani + metadati + id di pubblicazione)">
          ⤓ Esporta libreria
        </button>
        <button disabled={busy} onClick={() => libFileInputRef.current?.click()} title="Ripristina la libreria da un backup: quella attuale viene sostituita">
          ⤒ Importa libreria
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
        accept="application/json,.json,.xml,.musicxml"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importJson(f);
        }}
      />
      <input
        ref={libFileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importLibrary(f);
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
              <label className="menu-toggle" title="Mostra questo brano nel menu Libreria dell'editor">
                <input type="checkbox" checked={entry.inMenu} disabled={busy} onChange={(e) => toggleMenu(entry, e.target.checked)} />
                Nel menu
              </label>
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
              <ExportMenuButton label="⤓ JSON" title="Scarica il brano come file .json." onExport={(f) => void exportPiece(entry, f)} />
              <button disabled={busy} onClick={() => rename(entry)} title="Rinomina">Rinomina</button>
              <button disabled={busy} className="danger" onClick={() => remove(entry)} title="Elimina dalla lista">Elimina</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
