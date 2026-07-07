import { MutableRefObject, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Duration, DurationValue, NoteEvent, Pitch, ScoreState } from './music/types';
import { LayoutMode } from './music/layout';
import { durationTicks } from './music/theory';
import { scoreMeta, measureIndexAtTick } from './music/meta';
import { Player, playPreview } from './music/audio';
import { DEFAULT_INSTRUMENT_ID, INSTRUMENTS, Sampler, ensureInstrument, getInstrument, getLoadedSampler, isSynth } from './music/instruments';
import { MidiPlayer, requestMidiAccess, listOutputs, MidiOutputInfo } from './music/midi';
import { initialHistory, historyReducer } from './state/scoreReducer';
import { Tool, NOTE_TOOL } from './state/tool';
import { ClipNote, Clipboard, Selection } from './state/selection';
import { Toolbar } from './components/Toolbar';
import { Score, SystemRange } from './components/Score';
import { OptionsDialog } from './components/OptionsDialog';
import { PieceSummary, getPiece, listPieces } from './api';
import { exportMusicXML, importMusicXML } from './music/musicxml';
import { ExportFormat } from './components/ExportMenuButton';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** Editor state exposed to the admin page ("add current piece to the list"). */
export interface EditorSnapshot {
  name: string;
  bpm: number;
  score: ScoreState;
  sourceId: string | null; // server id the piece was loaded from (null = new/local)
}

interface AppProps {
  /** False while another page (admin) covers the editor: keyboard shortcuts pause. */
  active?: boolean;
  snapshotRef?: MutableRefObject<EditorSnapshot | null>;
}

export default function App({ active = true, snapshotRef }: AppProps) {
  const [hist, dispatch] = useReducer(historyReducer, undefined, () => initialHistory(4));
  const score = hist.present;

  const [tool, setTool] = useState<Tool>(NOTE_TOOL);
  const [duration, setDuration] = useState<Duration>({ value: 4, dots: 0 });
  const [previewOnCreate, setPreviewOnCreate] = useState(true);
  const [mode, setMode] = useState<LayoutMode>('page');
  const [bpm, setBpm] = useState(96);
  const [loop, setLoop] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadTick, setPlayheadTick] = useState<number | null>(null);
  const [cursorTick, setCursorTick] = useState(0); // persistent playback/insertion cursor
  const [hoverNote, setHoverNote] = useState<string | null>(null); // name of the ghost note under the cursor
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pieceName, setPieceName] = useState(''); // title of the current piece (shown + saved in the file)
  const [sourceId, setSourceId] = useState<string | null>(null); // server piece this was loaded from
  const [serverPieces, setServerPieces] = useState<PieceSummary[]>([]);

  // ---- application options (persisted) ----
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [diagonalBeams, setDiagonalBeams] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('opt.diagonalBeams');
      return stored === null ? true : stored === '1'; // default on; honour an explicit choice
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('opt.diagonalBeams', diagonalBeams ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [diagonalBeams]);
  const [loopSkipAnacrusis, setLoopSkipAnacrusis] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('opt.loopSkipAnacrusis');
      return stored === null ? true : stored === '1'; // default on
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('opt.loopSkipAnacrusis', loopSkipAnacrusis ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [loopSkipAnacrusis]);
  // expose the current piece to the admin page ("add current to the list")
  useEffect(() => {
    if (snapshotRef) snapshotRef.current = { name: pieceName, bpm, score, sourceId };
  }, [snapshotRef, pieceName, bpm, score, sourceId]);

  // server-side piece list for the Libreria dropdown (refreshed when the
  // editor regains the foreground, e.g. coming back from the admin page)
  useEffect(() => {
    if (!active) return;
    let alive = true;
    listPieces()
      .then((pieces) => alive && setServerPieces(pieces))
      .catch(() => {}); // no server (plain vite dev): built-in examples only
    return () => {
      alive = false;
    };
  }, [active]);

  // ---- playback instrument (persisted) ----
  const [instrument, setInstrument] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('opt.instrument');
      return stored && INSTRUMENTS.some((i) => i.id === stored) ? stored : DEFAULT_INSTRUMENT_ID;
    } catch {
      return DEFAULT_INSTRUMENT_ID;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('opt.instrument', instrument);
    } catch {
      /* ignore */
    }
  }, [instrument]);
  const [instrumentLoading, setInstrumentLoading] = useState(false);
  // fetch the sample set as soon as the instrument is picked, so Play starts instantly
  useEffect(() => {
    if (isSynth(instrument)) return;
    let alive = true;
    setInstrumentLoading(true);
    ensureInstrument(instrument)
      .catch(() => {}) // Play reports the failure; a later attempt retries
      .finally(() => {
        if (alive) setInstrumentLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [instrument]);

  const clipboardRef = useRef<Clipboard | null>(null);
  const systemRangesRef = useRef<SystemRange[]>([]);
  const onLayout = useCallback((ranges: SystemRange[]) => {
    systemRangesRef.current = ranges;
  }, []);

  const playerRef = useRef<Player | null>(null);
  const playheadTickRef = useRef<number | null>(null); // latest live playback position (for pause/resume)
  const loopRef = useRef(loop);
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  // ---- MIDI playback ----
  const [midiOn, setMidiOn] = useState(false);
  const [midiOutputs, setMidiOutputs] = useState<MidiOutputInfo[]>([]);
  const [midiOutId, setMidiOutId] = useState('');
  const [midiChannel, setMidiChannel] = useState(1); // 1..16 in the UI
  const midiPlayerRef = useRef<MidiPlayer | null>(null);

  // route the chosen output / channel into the live player
  useEffect(() => {
    if (midiPlayerRef.current && midiOutId) midiPlayerRef.current.setOutput(midiOutId);
  }, [midiOutId]);
  useEffect(() => {
    if (midiPlayerRef.current) midiPlayerRef.current.channel = midiChannel - 1;
  }, [midiChannel]);

  const handleToggleMidi = useCallback(async () => {
    if (midiOn) {
      midiPlayerRef.current?.stop();
      setMidiOn(false);
      return;
    }
    const access = await requestMidiAccess();
    if (!access) {
      window.alert(
        'Web MIDI non disponibile: il browser non lo supporta o il permesso è stato negato.\n' +
          'Usa Chrome/Edge (o Firefox con flag) e consenti l’accesso MIDI.',
      );
      return;
    }
    const outs = listOutputs(access);
    if (outs.length === 0) {
      window.alert('Nessuna uscita MIDI trovata. Collega o avvia un dispositivo/synth MIDI e riprova.');
      return;
    }
    const player = midiPlayerRef.current ?? new MidiPlayer(access);
    midiPlayerRef.current = player;
    player.channel = midiChannel - 1;
    setMidiOutputs(outs);
    const first = outs[0].id;
    setMidiOutId(first);
    player.setOutput(first);
    setMidiOn(true);
  }, [midiOn, midiChannel]);

  // changing tool always starts from a clean selection
  useEffect(() => {
    setSelection(null);
    setHoverNote(null);
  }, [tool.kind]);

  // apply tempo changes live while a player is running
  useEffect(() => {
    if (playerRef.current?.playing) playerRef.current.setBpm(bpm);
    if (midiPlayerRef.current?.playing) midiPlayerRef.current.setBpm(bpm);
  }, [bpm]);

  // keep the "skip anacrusis on loop" choice applied to a running player too
  useEffect(() => {
    if (playerRef.current) playerRef.current.skipPickupInLoop = loopSkipAnacrusis;
    if (midiPlayerRef.current) midiPlayerRef.current.skipPickupInLoop = loopSkipAnacrusis;
  }, [loopSkipAnacrusis]);

  const playReqRef = useRef(0); // invalidates a Play still waiting on samples when Stop arrives first

  const handleStop = useCallback(() => {
    playReqRef.current++;
    playerRef.current?.stop();
    midiPlayerRef.current?.stop();
    // pause/resume: leave the indicator where playback was stopped
    const at = playheadTickRef.current;
    playheadTickRef.current = null;
    if (at !== null) setCursorTick(Math.max(0, Math.round(at)));
    setIsPlaying(false);
    setPlayheadTick(null);
  }, []);

  const handlePlay = useCallback(async () => {
    const onTick = (tick: number) => {
      playheadTickRef.current = tick;
      setPlayheadTick(tick);
    };
    const onEnd = () => {
      playheadTickRef.current = null;
      setIsPlaying(false);
      setPlayheadTick(null);
      setCursorTick(0); // reached the end: rewind to the start
    };
    const startTick = Math.max(0, Math.round(cursorTick)); // play from the indicator (Player rewinds if it's at/after the end)
    // Drive an external MIDI device when MIDI is enabled and an output is set;
    // otherwise fall back to the built-in Web Audio synth.
    const mp = midiPlayerRef.current;
    if (midiOn && mp?.output) {
      playerRef.current?.stop();
      mp.loop = loopRef.current;
      mp.skipPickupInLoop = loopSkipAnacrusis;
      mp.channel = midiChannel - 1;
      mp.onTick = onTick;
      mp.onEnd = onEnd;
      mp.play(score, bpm, startTick);
      setIsPlaying(true);
      return;
    }
    let sampler: Sampler | null = null;
    if (!isSynth(instrument)) {
      const req = ++playReqRef.current;
      setInstrumentLoading(true);
      try {
        sampler = await ensureInstrument(instrument);
      } catch {
        window.alert(
          `Impossibile scaricare i campioni di "${getInstrument(instrument)?.name ?? instrument}".\n` +
            'Controlla la connessione, oppure scegli "8 bit sound".',
        );
        return;
      } finally {
        setInstrumentLoading(false);
      }
      if (req !== playReqRef.current) return; // Stop pressed while loading
    }
    const player = playerRef.current ?? new Player();
    playerRef.current = player;
    player.sampler = sampler;
    player.loop = loopRef.current; // looping is handled inside the Player (seamless)
    player.skipPickupInLoop = loopSkipAnacrusis;
    player.onTick = onTick;
    player.onEnd = onEnd;
    player.play(score, bpm, startTick);
    setIsPlaying(true);
  }, [bpm, score, midiOn, midiChannel, loopSkipAnacrusis, cursorTick, instrument]);

  const handleToStart = useCallback(() => setCursorTick(0), []);

  const handleSetLoop = useCallback((v: boolean) => {
    setLoop(v);
    loopRef.current = v;
    if (playerRef.current) playerRef.current.loop = v; // apply immediately if playing
    if (midiPlayerRef.current) midiPlayerRef.current.loop = v;
  }, []);

  // After a one-shot accidental/eraser is applied, revert to the note tool.
  const handleAfterApply = useCallback(() => {
    setTool((t) => ((t.kind === 'accidental' || t.kind === 'eraser' || t.kind === 'dot' || t.kind === 'tuplet' || t.kind === 'tie' || t.kind === 'chord' || t.kind === 'arpeggio' || t.kind === 'staccato') && !t.sticky ? NOTE_TOOL : t));
  }, []);

  // preview with the selected instrument when its samples are already in memory
  // (they load in the background on selection); synth otherwise
  const handlePreviewNote = useCallback((pitches: Pitch[]) => playPreview(pitches, 0.5, getLoadedSampler(instrument)), [instrument]);

  const handleLoadPiece = useCallback(
    async (id: string) => {
      try {
        const p = await getPiece(id);
        handleStop();
        setSelection(null);
        setCursorTick(0);
        dispatch({ type: 'LOAD', score: clone(p.score) });
        setBpm(p.bpm);
        setPieceName(p.title);
        setSourceId(id);
      } catch {
        window.alert('Impossibile caricare il brano dal server.');
      }
    },
    [handleStop],
  );

  // the admin page's "Apri nell'editor" hands the piece over via sessionStorage
  useEffect(() => {
    if (!active) return;
    const pending = sessionStorage.getItem('pending.load');
    if (!pending) return;
    sessionStorage.removeItem('pending.load');
    void handleLoadPiece(pending);
  }, [active, handleLoadPiece]);

  const onSelectMeasures = useCallback((indices: number[]) => {
    setSelection(indices.length ? { kind: 'measures', indices } : null);
  }, []);
  const onSelectNotes = useCallback((ids: string[]) => {
    setSelection(ids.length ? { kind: 'notes', ids } : null);
  }, []);
  const onClearSelection = useCallback(() => setSelection(null), []);
  const onSetCursor = useCallback((tick: number) => setCursorTick(Math.max(0, tick)), []);

  // ---- save / load a piece as a .json file ----
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSaveFile = useCallback(
    (format: ExportFormat) => {
      // a piece started from scratch has no title yet: ask for one on first save
      let title = pieceName;
      if (!title) {
        const name = window.prompt('Nome del brano:', '');
        if (name === null) return; // cancelled
        title = name.trim();
        setPieceName(title);
      }
      const safe = title.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'brano';
      const [content, filename, type] =
        format === 'musicxml'
          ? [exportMusicXML(title, bpm, score), `${safe}.musicxml`, 'application/vnd.recordare.musicxml+xml']
          : [JSON.stringify({ format: 'score-composer', version: 1, name: title, bpm, score }, null, 2), `${safe}.json`, 'application/json'];
      const url = URL.createObjectURL(new Blob([content], { type }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    [bpm, score, pieceName],
  );

  const handleRequestLoadFile = useCallback(() => fileInputRef.current?.click(), []);

  const handleLoadFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ''; // allow re-loading the same file later
      if (!file) return;
      const raw = await file.text();
      const applyLoaded = (loaded: ScoreState, loadedBpm: number | null, title: string) => {
        handleStop();
        setSelection(null);
        setCursorTick(0);
        dispatch({ type: 'LOAD', score: clone(loaded) });
        if (loadedBpm !== null) setBpm(loadedBpm);
        setPieceName(title);
        setSourceId(null);
      };
      // MusicXML (by extension or content) or the app's own JSON
      if (/\.(xml|musicxml)$/i.test(file.name) || raw.trimStart().startsWith('<')) {
        try {
          const imp = importMusicXML(raw);
          applyLoaded(imp.score, imp.bpm, imp.name);
        } catch (err) {
          window.alert(`Impossibile importare il MusicXML: ${err instanceof Error ? err.message : 'file non valido'}.`);
        }
        return;
      }
      try {
        const obj = JSON.parse(raw);
        const loaded: ScoreState | undefined = obj?.score ?? (Array.isArray(obj?.measures) ? obj : undefined);
        if (!loaded || !Array.isArray(loaded.measures) || !loaded.timeSignature) {
          window.alert('File non valido: non sembra un brano di Score Composer.');
          return;
        }
        applyLoaded(loaded, typeof obj?.bpm === 'number' ? obj.bpm : null, typeof obj?.name === 'string' ? obj.name : '');
      } catch {
        window.alert('Impossibile leggere il file (JSON non valido).');
      }
    },
    [handleStop],
  );

  const handleInsertMeasures = useCallback(() => {
    const raw = window.prompt('Quante battute vuote inserire al punto di playback?', '1');
    if (raw === null) return;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    const m = scoreMeta(score);
    const idx = cursorTick >= m.totalTicks ? score.measures.length : measureIndexAtTick(m, cursorTick);
    dispatch({ type: 'PASTE_MEASURES', index: idx, measures: Array.from({ length: n }, () => ({ id: '', events: [] })) });
  }, [score, cursorTick]);

  // stop audio when the component unmounts
  useEffect(
    () => () => {
      playerRef.current?.stop();
      midiPlayerRef.current?.stop();
    },
    [],
  );

  // keyboard shortcuts (paused while another page covers the editor)
  useEffect(() => {
    if (!active) return;
    const meta = scoreMeta(score);
    const copyOf = (): Clipboard | null => {
      if (!selection) return null;
      if (selection.kind === 'measures') {
        const idx = new Set(selection.indices);
        return { kind: 'measures', measures: score.measures.filter((_, i) => idx.has(i)).map(clone) };
      }
      const ids = new Set(selection.ids);
      const picked: { g: number; staff: NoteEvent['staff']; duration: NoteEvent['duration']; pitches: NoteEvent['pitches']; tuplet: NoteEvent['tuplet'] }[] = [];
      score.measures.forEach((m, mi) =>
        m.events.forEach((e) => {
          if (e.kind === 'note' && ids.has(e.id)) picked.push({ g: meta.measures[mi].startTick + e.startTick, staff: e.staff, duration: e.duration, pitches: e.pitches, tuplet: e.tuplet });
        }),
      );
      if (picked.length === 0) return null;
      const minG = Math.min(...picked.map((p) => p.g));
      const events: ClipNote[] = picked.map((p) => ({ offset: p.g - minG, staff: p.staff, duration: clone(p.duration), pitches: clone(p.pitches), ...(p.tuplet ? { tuplet: clone(p.tuplet) } : {}) }));
      return { kind: 'notes', events };
    };
    const deleteSelection = () => {
      if (!selection) return;
      if (selection.kind === 'measures') dispatch({ type: 'DELETE_MEASURES', indices: selection.indices });
      else dispatch({ type: 'DELETE_NOTES', ids: selection.ids });
      setSelection(null);
    };

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        dispatch({ type: 'UNDO' });
        setSelection(null);
        e.preventDefault();
        return;
      }
      if (mod && e.key.toLowerCase() === 'c') {
        const cb = copyOf();
        if (cb) clipboardRef.current = cb;
        return;
      }
      if (mod && e.key.toLowerCase() === 'x') {
        const cb = copyOf();
        if (cb) clipboardRef.current = cb;
        deleteSelection();
        e.preventDefault();
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        const cb = clipboardRef.current;
        if (!cb) return;
        if (cb.kind === 'notes') {
          if (cb.events.length === 0) return;
          dispatch({ type: 'PASTE_NOTES', baseTick: Math.round(cursorTick), events: cb.events });
        } else {
          if (cb.measures.length === 0) return;
          const idx = cursorTick >= meta.totalTicks ? score.measures.length : measureIndexAtTick(meta, cursorTick);
          dispatch({ type: 'PASTE_MEASURES', index: idx, measures: cb.measures });
        }
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selection) {
          deleteSelection();
          e.preventDefault();
        }
        return;
      }

      // transpose selected notes up/down diatonically
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (selection?.kind === 'notes') {
          dispatch({ type: 'TRANSPOSE_NOTES', ids: selection.ids, delta: e.key === 'ArrowUp' ? 1 : -1 });
          e.preventDefault();
        }
        return;
      }

      // move the playback/insertion cursor
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const maxTick = meta.totalTicks;
        const startOf = (mi: number) => (mi >= meta.measures.length ? maxTick : meta.measures[Math.max(0, mi)].startTick);
        const curMi = measureIndexAtTick(meta, cursorTick);
        let next: number;
        if (e.ctrlKey || e.metaKey) {
          // whole system / row
          const ranges = systemRangesRef.current;
          const si = ranges.findIndex((r) => curMi >= r.first && curMi <= r.last);
          const target = ranges[Math.max(0, Math.min((si < 0 ? 0 : si) + dir, ranges.length - 1))];
          next = target ? startOf(target.first) : cursorTick;
        } else if (e.altKey) {
          // one measure
          const onBoundary = cursorTick === meta.measures[curMi].startTick;
          const targetMi = dir > 0 ? curMi + 1 : onBoundary ? curMi - 1 : curMi;
          next = startOf(Math.max(0, targetMi));
        } else {
          next = cursorTick + dir * durationTicks(duration);
        }
        setCursorTick(Math.max(0, Math.min(next, maxTick)));
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        isPlaying ? handleStop() : handlePlay();
      } else if (e.key >= '1' && e.key <= '6') {
        const map: DurationValue[] = [1, 2, 4, 8, 16, 32];
        setDuration((d) => ({ ...d, value: map[Number(e.key) - 1] }));
      } else if (e.key === '.') {
        setTool((t) => (t.kind === 'dot' && t.dots === 1 ? NOTE_TOOL : { kind: 'dot', dots: 1, sticky: false }));
      } else if (e.key.toLowerCase() === 'e') {
        setTool((t) => (t.kind === 'eraser' ? NOTE_TOOL : { kind: 'eraser', sticky: false }));
      } else if (e.key === 'Escape') {
        setTool(NOTE_TOOL);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, isPlaying, handlePlay, handleStop, selection, score, cursorTick, duration]);

  // time/key shown in the tools follow the measure under the playhead (or the cursor)
  const meta = scoreMeta(score);
  const activeMeasure = measureIndexAtTick(meta, playheadTick ?? cursorTick);
  const activeTs = meta.measures[activeMeasure]?.ts ?? score.timeSignature;
  const activeKey = meta.measures[activeMeasure]?.keySig ?? score.keySignature;
  const hasPickup = !!score.measures[0]?.pickup; // the anacrusis is the (uncounted) first measure
  const measureLabel = hasPickup ? (activeMeasure === 0 ? 'levare' : `batt. ${activeMeasure}`) : `batt. ${activeMeasure + 1}`;

  const handleToggleAnacrusis = useCallback(() => {
    dispatch({ type: 'SET_PICKUP', on: !score.measures[0]?.pickup });
  }, [score]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Score Composer</h1>
        <span className="subtitle">endecalineo · composizione &amp; playback</span>
        {pieceName && <span className="piece-name" title="Brano corrente">{pieceName}</span>}
        <a className="admin-link" href="#/admin" title="Gestione della lista dei brani (solo admin)">
          Gestione brani
        </a>
      </header>

      <Toolbar
        tool={tool}
        setTool={setTool}
        duration={duration}
        setDuration={setDuration}
        hoverNote={hoverNote}
        previewOnCreate={previewOnCreate}
        setPreviewOnCreate={setPreviewOnCreate}
        measureLabel={measureLabel}
        hasPickup={hasPickup}
        onToggleAnacrusis={handleToggleAnacrusis}
        timeSignature={activeTs}
        setTimeSignature={(ts) => dispatch({ type: 'SET_TIME_SIGNATURE_AT', measureIndex: activeMeasure, timeSignature: ts })}
        keySignature={activeKey}
        setKeySignature={(k) => dispatch({ type: 'SET_KEY_SIGNATURE_AT', measureIndex: activeMeasure, keySignature: k })}
        mode={mode}
        setMode={setMode}
        bpm={bpm}
        setBpm={setBpm}
        loop={loop}
        setLoop={handleSetLoop}
        instrument={instrument}
        setInstrument={setInstrument}
        instrumentLoading={instrumentLoading}
        midiOn={midiOn}
        onToggleMidi={handleToggleMidi}
        midiOutputs={midiOutputs}
        midiOutId={midiOutId}
        setMidiOutId={setMidiOutId}
        midiChannel={midiChannel}
        setMidiChannel={setMidiChannel}
        isPlaying={isPlaying}
        onPlay={handlePlay}
        onStop={handleStop}
        onToStart={handleToStart}
        onAddMeasure={() => dispatch({ type: 'ADD_MEASURE' })}
        onRemoveMeasure={() => dispatch({ type: 'REMOVE_LAST_MEASURE' })}
        onClear={() => {
          // wiping the music also wipes the identity: title and server origin
          dispatch({ type: 'CLEAR' });
          setPieceName('');
          setSourceId(null);
        }}
        onLoadPiece={handleLoadPiece}
        menuPieces={serverPieces.filter((p) => p.inMenu)}
        onInsertMeasures={handleInsertMeasures}
        onSaveFile={handleSaveFile}
        onLoadFile={handleRequestLoadFile}
        onOpenOptions={() => setOptionsOpen(true)}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json,.xml,.musicxml"
        style={{ display: 'none' }}
        onChange={handleLoadFile}
      />

      <Score
        state={score}
        mode={mode}
        tool={tool}
        duration={duration}
        diagonalBeams={diagonalBeams}
        previewOnCreate={previewOnCreate}
        selection={selection}
        playheadTick={playheadTick}
        cursorTick={cursorTick}
        onAction={dispatch}
        onAfterApply={handleAfterApply}
        onPreviewNote={handlePreviewNote}
        onSelectMeasures={onSelectMeasures}
        onSelectNotes={onSelectNotes}
        onClearSelection={onClearSelection}
        onSetCursor={onSetCursor}
        onHoverNote={setHoverNote}
        onLayout={onLayout}
      />

      <footer className="hint">
        Palette: <strong>note</strong> sopra, <strong>pause</strong> sotto. Le pause riempiono automaticamente lo spazio
        libero. Trascina una nota per spostarla; <kbd>Alt</kbd>+clic la cancella.{' '}
        <strong>Alterazioni</strong>, <strong>punti</strong> e <strong>gomma</strong>: clic su una nota (1 = una volta, doppio = fisso).
        <strong> Selezione</strong> battute o note (lazo): <kbd>⌘C</kbd>/<kbd>X</kbd>/<kbd>V</kbd> · <kbd>Backspace</kbd>{' '}
        elimina · <kbd>⌘Z</kbd> annulla. <kbd>← →</kbd> sposta cursore (<kbd>Alt</kbd> battuta, <kbd>Ctrl</kbd> rigo) ·{' '}
        <kbd>↑ ↓</kbd> traspone le note selezionate. <kbd>1-6</kbd> durata · <kbd>.</kbd> punto · <kbd>E</kbd> gomma ·{' '}
        <kbd>Esc</kbd> note · <kbd>Spazio</kbd> play/stop.
      </footer>

      <OptionsDialog
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        diagonalBeams={diagonalBeams}
        setDiagonalBeams={setDiagonalBeams}
        loopSkipAnacrusis={loopSkipAnacrusis}
        setLoopSkipAnacrusis={setLoopSkipAnacrusis}
      />
    </div>
  );
}
