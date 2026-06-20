import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Duration, DurationValue, Pitch } from './music/types';
import { LayoutMode } from './music/layout';
import { TICKS_PER_QUARTER } from './music/constants';
import { Player, playPreview } from './music/audio';
import { LIBRARY } from './music/library';
import { initialScore, scoreReducer } from './state/scoreReducer';
import { Tool, NOTE_TOOL } from './state/tool';
import { Toolbar } from './components/Toolbar';
import { Score } from './components/Score';

export default function App() {
  const [score, dispatch] = useReducer(scoreReducer, undefined, () => initialScore(4));

  const [tool, setTool] = useState<Tool>(NOTE_TOOL);
  const [duration, setDuration] = useState<Duration>({ value: 4, dots: 0 });
  const [previewOnCreate, setPreviewOnCreate] = useState(false);
  const [mode, setMode] = useState<LayoutMode>('horizontal');
  const [bpm, setBpm] = useState(96);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playheadTick, setPlayheadTick] = useState<number | null>(null);

  const playerRef = useRef<Player | null>(null);

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
      setIsPlaying(false);
      setPlayheadTick(null);
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
      // deep-clone so editing never mutates the library constant
      dispatch({ type: 'LOAD', score: JSON.parse(JSON.stringify(piece.score)) });
      setBpm(piece.bpm);
    },
    [handleStop],
  );

  // stop audio when the component unmounts
  useEffect(() => () => playerRef.current?.stop(), []);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;
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
  }, [isPlaying, handlePlay, handleStop]);

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
        playheadTick={playheadTick}
        onAction={dispatch}
        onAfterApply={handleAfterApply}
        onPreviewNote={handlePreviewNote}
      />

      <footer className="hint">
        Scegli una durata, poi muovi il mouse sul pentagramma: appare l'anteprima in grigio. Clicca per inserire una nota
        (in uno spazio libero) o per aggiungerla come accordo (su una nota esistente). Le <strong>pause</strong> riempiono
        automaticamente lo spazio libero di ogni battuta. Le <strong>alterazioni</strong> e la <strong>gomma</strong> si
        applicano cliccando su una nota esistente (1 click = una volta, doppio click = modalità fissa). <kbd>1-6</kbd>{' '}
        durata · <kbd>.</kbd> punto · <kbd>E</kbd> gomma · <kbd>Esc</kbd> note · <kbd>Spazio</kbd> play/stop.
      </footer>
    </div>
  );
}
