import { Duration, DurationValue, TimeSignature } from '../music/types';
import { durationLabel } from '../music/theory';
import { SMUFL } from '../music/smufl';
import { LayoutMode } from '../music/layout';

const DURATIONS: DurationValue[] = [1, 2, 4, 8, 16, 32];

const TIME_PRESETS: TimeSignature[] = [
  { numerator: 2, denominator: 4 },
  { numerator: 3, denominator: 4 },
  { numerator: 4, denominator: 4 },
  { numerator: 5, denominator: 4 },
  { numerator: 6, denominator: 8 },
  { numerator: 9, denominator: 8 },
  { numerator: 12, denominator: 8 },
  { numerator: 3, denominator: 8 },
  { numerator: 2, denominator: 2 },
];

interface ToolbarProps {
  tool: 'note' | 'rest';
  setTool: (t: 'note' | 'rest') => void;
  duration: Duration;
  setDuration: (d: Duration) => void;
  accidental: -1 | 0 | 1;
  setAccidental: (a: -1 | 0 | 1) => void;
  timeSignature: TimeSignature;
  setTimeSignature: (ts: TimeSignature) => void;
  mode: LayoutMode;
  setMode: (m: LayoutMode) => void;
  bpm: number;
  setBpm: (n: number) => void;
  isPlaying: boolean;
  onPlay: () => void;
  onStop: () => void;
  onAddMeasure: () => void;
  onRemoveMeasure: () => void;
  onClear: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const {
    tool,
    setTool,
    duration,
    setDuration,
    accidental,
    setAccidental,
    timeSignature,
    setTimeSignature,
    mode,
    setMode,
    bpm,
    setBpm,
    isPlaying,
    onPlay,
    onStop,
    onAddMeasure,
    onRemoveMeasure,
    onClear,
  } = props;

  return (
    <div className="toolbar">
      <fieldset className="group">
        <legend>Strumento</legend>
        <div className="btn-row">
          <button className={tool === 'note' ? 'on' : ''} onClick={() => setTool('note')} title="Inserisci note">
            Note
          </button>
          <button className={tool === 'rest' ? 'on' : ''} onClick={() => setTool('rest')} title="Inserisci pause">
            Pause
          </button>
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>Durata</legend>
        <div className="btn-row">
          {DURATIONS.map((v) => (
            <button
              key={v}
              className={`glyph-btn ${duration.value === v ? 'on' : ''}`}
              onClick={() => setDuration({ ...duration, value: v })}
              title={durationLabel({ value: v, dots: 0 })}
            >
              <span className="bravura">{SMUFL.paletteNotes[v]}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>Punti</legend>
        <div className="btn-row">
          {[0, 1, 2].map((n) => (
            <button
              key={n}
              className={duration.dots === n ? 'on' : ''}
              onClick={() => setDuration({ ...duration, dots: n as 0 | 1 | 2 })}
              title={`${n} punti di valore`}
            >
              {n === 0 ? '—' : '•'.repeat(n)}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>Alterazione</legend>
        <div className="btn-row">
          <button className={accidental === 0 ? 'on' : ''} onClick={() => setAccidental(0)} title="Nessuna alterazione">
            ♮
          </button>
          <button className={accidental === 1 ? 'on' : ''} onClick={() => setAccidental(1)} title="Diesis">
            ♯
          </button>
          <button className={accidental === -1 ? 'on' : ''} onClick={() => setAccidental(-1)} title="Bemolle">
            ♭
          </button>
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>Battuta</legend>
        <select
          value={`${timeSignature.numerator}/${timeSignature.denominator}`}
          onChange={(e) => {
            const [n, d] = e.target.value.split('/').map(Number);
            setTimeSignature({ numerator: n, denominator: d });
          }}
        >
          {TIME_PRESETS.map((ts) => {
            const key = `${ts.numerator}/${ts.denominator}`;
            return (
              <option key={key} value={key}>
                {key}
              </option>
            );
          })}
        </select>
      </fieldset>

      <fieldset className="group">
        <legend>Vista</legend>
        <div className="btn-row">
          <button className={mode === 'horizontal' ? 'on' : ''} onClick={() => setMode('horizontal')}>
            Orizzontale
          </button>
          <button className={mode === 'page' ? 'on' : ''} onClick={() => setMode('page')}>
            Pagina
          </button>
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>Misure</legend>
        <div className="btn-row">
          <button onClick={onAddMeasure} title="Aggiungi una battuta">+ Battuta</button>
          <button onClick={onRemoveMeasure} title="Rimuovi l'ultima battuta">− Battuta</button>
          <button onClick={onClear} title="Svuota tutte le battute">Pulisci</button>
        </div>
      </fieldset>

      <fieldset className="group transport">
        <legend>Playback</legend>
        <div className="btn-row">
          <button className={`play ${isPlaying ? 'stop' : ''}`} onClick={isPlaying ? onStop : onPlay}>
            {isPlaying ? '■ Stop' : '▶ Play'}
          </button>
          <label className="bpm">
            BPM
            <input
              type="number"
              min={30}
              max={300}
              value={bpm}
              onChange={(e) => setBpm(Math.max(30, Math.min(300, Number(e.target.value) || 0)))}
            />
          </label>
          <input
            type="range"
            min={30}
            max={300}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            aria-label="BPM"
          />
        </div>
      </fieldset>
    </div>
  );
}
