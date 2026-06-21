import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Duration, DurationValue, NoteEvent, Pitch, ScoreState } from './music/types';
import { LayoutMode, clamp } from './music/layout';
import { measureTicks } from './music/theory';
import { TICKS_PER_QUARTER } from './music/constants';
import { Player, playPreview } from './music/audio';
import { LIBRARY } from './music/library';
import { initialScore, scoreReducer } from './state/scoreReducer';
import { Tool, NOTE_TOOL } from './state/tool';
import { Clipboard, Selection } from './state/selection';
import { Toolbar } from './components/Toolbar';
import { Score } from './components/Score';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export default function App() {
  const [score, dispatch] = useReducer(scoreReducer, undefined, () => initialScore(4));

  const [tool, setTool] = useState<Tool>(NOTE_TOOL);
  const [duration, setDuration] = useState<Duration>({ value: 4, dots: 0 });
  const [previewOnCreate, setPreviewOnCreate] = useState(true);
  const [mode, setMode] = useState<LayoutMode>('horizontal');
  const [bpm, setBpm] = useState(96);
  const [loop, setLoop] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadTick, setPlayheadTick] = useState<number | null>(null);
  const [cursorTick, setCursorTick] = useState(0); // persistent playback/insertion cursor
  const [selection, setSelection] = useState<Selection | null>(null);
  const clipboardRef = useRef<Clipboard | null>(null);
  const undoRef = useRef<ScoreState[]>([]);

  const playerRef = useRef<Player | null>(null);
  const loopRef = useRef(loop);
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  // changing tool always starts from a clean selection
  useEffect(() => {
    setSelection(null);
  }, [tool.kind]);

  const handleStop = useCallback(() => {
    playerRef.current?.stop();
    setIsPlaying(false);
    setPlayheadTick(null);
  }, []);

  const handlePlay = useCallback(() => {
    const player = playerRef.current ?? new Player();
    playerRef.current = player;
    const secPerTick = 60 / bpm / TICKS_PER_QUARTER;
    player.onTick = (sec) => setPlayheadTick(sec / secPerTick);
    player.onEnd = () => {
      if (loopRef.current) {
        player.play(score, bpm); // restart; handlers stay attached
      } else {
        setIsPlaying(false);
        setPlayheadTick(null);
      }
    };
    player.play(score, bpm);
    setIsPlaying(true);
  }, [bpm, score]);

  // After a one-shot accidental/eraser is applied, revert to the note tool.
  const handleAfterApply = useCallback(() => {
    setTool((t) => ((t.kind === 'accidental' || t.kind === 'eraser') && !t.sticky ? NOTE_TOOL : t));
  }, []);

  const handlePreviewNote = useCallback((pitches: Pitch[]) => playPreview(pitches), []);

  const handleLoadPiece = useCallback(
    (id: string) => {
      const piece = LIBRARY.find((p) => p.id === id);
      if (!piece) return;
      handleStop();
      setSelection(null);
      dispatch({ type: 'LOAD', score: clone(piece.score) });
      setBpm(piece.bpm);
    },
    [handleStop],
  );

  const onSelectMeasures = useCallback((indices: number[]) => {
    setSelection(indices.length ? { kind: 'measures', indices } : null);
  }, []);
  const onSelectNotes = useCallback((ids: string[]) => {
    setSelection(ids.length ? { kind: 'notes', ids } : null);
  }, []);
  const onClearSelection = useCallback(() => setSelection(null), []);
  const onSetCursor = useCallback((tick: number) => setCursorTick(Math.max(0, tick)), []);

  // stop audio when the component unmounts
  useEffect(() => () => playerRef.current?.stop(), []);

  // keyboard shortcuts
  useEffect(() => {
    const copyOf = (): Clipboard | null => {
      if (!selection) return null;
      if (selection.kind === 'measures') {
        const idx = new Set(selection.indices);
        return { kind: 'measures', measures: score.measures.filter((_, i) => idx.has(i)).map(clone) };
      }
      const ids = new Set(selection.ids);
      const events = score.measures
        .flatMap((m) => m.events)
        .filter((e): e is NoteEvent => e.kind === 'note' && ids.has(e.id))
        .map(clone);
      return { kind: 'notes', events };
    };
    const pushUndo = () => {
      undoRef.current.push(clone(score));
      if (undoRef.current.length > 50) undoRef.current.shift();
    };
    const deleteSelection = () => {
      if (!selection) return;
      pushUndo();
      if (selection.kind === 'measures') dispatch({ type: 'DELETE_MEASURES', indices: selection.indices });
      else dispatch({ type: 'DELETE_NOTES', ids: selection.ids });
      setSelection(null);
    };

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        const prev = undoRef.current.pop();
        if (prev) {
          dispatch({ type: 'LOAD', score: prev });
          setSelection(null);
        }
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
        const total = measureTicks(score.timeSignature);
        if (cb.kind === 'notes') {
          if (cb.events.length === 0) return;
          const mi = clamp(Math.floor(cursorTick / total), 0, score.measures.length - 1);
          const tick = Math.round(cursorTick - mi * total);
          pushUndo();
          dispatch({ type: 'PASTE_NOTES', measureIndex: mi, tick, events: cb.events });
        } else {
          if (cb.measures.length === 0) return;
          const idx = clamp(Math.floor(cursorTick / total), 0, score.measures.length);
          pushUndo();
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

      if (e.code === 'Space') {
        e.preventDefault();
        isPlaying ? handleStop() : handlePlay();
      } else if (e.key >= '1' && e.key <= '6') {
        const map: DurationValue[] = [1, 2, 4, 8, 16, 32];
        setDuration((d) => ({ ...d, value: map[Number(e.key) - 1] }));
      } else if (e.key === '.') {
        setDuration((d) => ({ ...d, dots: ((d.dots + 1) % 3) as 0 | 1 | 2 }));
      } else if (e.key.toLowerCase() === 'e') {
        setTool((t) => (t.kind === 'eraser' ? NOTE_TOOL : { kind: 'eraser', sticky: false }));
      } else if (e.key === 'Escape') {
        setTool(NOTE_TOOL);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPlaying, handlePlay, handleStop, selection, score, cursorTick]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Score Composer</h1>
        <span className="subtitle">endecalineo · composizione &amp; playback</span>
      </header>

      <Toolbar
        tool={tool}
        setTool={setTool}
        duration={duration}
        setDuration={setDuration}
        previewOnCreate={previewOnCreate}
        setPreviewOnCreate={setPreviewOnCreate}
        timeSignature={score.timeSignature}
        setTimeSignature={(ts) => dispatch({ type: 'SET_TIME_SIGNATURE', timeSignature: ts })}
        mode={mode}
        setMode={setMode}
        bpm={bpm}
        setBpm={setBpm}
        loop={loop}
        setLoop={setLoop}
        isPlaying={isPlaying}
        onPlay={handlePlay}
        onStop={handleStop}
        onAddMeasure={() => dispatch({ type: 'ADD_MEASURE' })}
        onRemoveMeasure={() => dispatch({ type: 'REMOVE_LAST_MEASURE' })}
        onClear={() => dispatch({ type: 'CLEAR' })}
        onLoadPiece={handleLoadPiece}
      />

      <Score
        state={score}
        mode={mode}
        tool={tool}
        duration={duration}
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
      />

      <footer className="hint">
        Palette: <strong>note</strong> sopra, <strong>pause</strong> sotto. Le pause riempiono automaticamente lo spazio
        libero. <strong>Alterazioni</strong> e <strong>gomma</strong>: clic su una nota (1 = una volta, doppio = fisso).
        <strong> Selezione</strong> battute o note (lazo): <kbd>⌘C</kbd>/<kbd>X</kbd> copia/taglia · <kbd>Backspace</kbd>{' '}
        elimina. <kbd>1-6</kbd> durata · <kbd>.</kbd> punto · <kbd>E</kbd> gomma · <kbd>Esc</kbd> note · <kbd>Spazio</kbd>{' '}
        play/stop.
      </footer>
    </div>
  );
}
