import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Duration, DurationValue } from './music/types';
import { LayoutMode } from './music/layout';
import { TICKS_PER_QUARTER } from './music/constants';
import { Player } from './music/audio';
import { initialScore, scoreReducer } from './state/scoreReducer';
import { Toolbar } from './components/Toolbar';
import { Score } from './components/Score';

export default function App() {
  const [score, dispatch] = useReducer(scoreReducer, undefined, () => initialScore(4));

  const [tool, setTool] = useState<'note' | 'rest'>('note');
  const [duration, setDuration] = useState<Duration>({ value: 4, dots: 0 });
  const [accidental, setAccidental] = useState<-1 | 0 | 1>(0);
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
      } else if (e.key.toLowerCase() === 'r') {
        setTool((t) => (t === 'rest' ? 'note' : 'rest'));
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
        accidental={accidental}
        setAccidental={setAccidental}
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
      />

      <Score
        state={score}
        mode={mode}
        tool={tool}
        duration={duration}
        accidental={accidental}
        playheadTick={playheadTick}
        onAction={dispatch}
      />

      <footer className="hint">
        Scegli una durata, poi muovi il mouse sul pentagramma: appare l'anteprima in grigio. Clicca per inserire una nota
        (in uno spazio libero) o per aggiungerla come accordo (su una nota esistente). Clicca su una nota già presente per
        cancellarla. <kbd>1-6</kbd> durata · <kbd>.</kbd> punto · <kbd>R</kbd> note/pause · <kbd>Spazio</kbd> play/stop.
      </footer>
    </div>
  );
}
