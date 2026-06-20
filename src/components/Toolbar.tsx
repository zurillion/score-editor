import { Duration, DurationValue, Alter, TimeSignature } from '../music/types';
import { durationLabel } from '../music/theory';
import { SMUFL } from '../music/smufl';
import { LayoutMode } from '../music/layout';
import { Tool } from '../state/tool';
import { LIBRARY } from '../music/library';

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

const ACCIDENTALS: { alter: Alter; title: string }[] = [
  { alter: -2, title: 'Doppio bemolle' },
  { alter: -1, title: 'Bemolle' },
  { alter: 0, title: 'Bequadro' },
  { alter: 1, title: 'Diesis' },
  { alter: 2, title: 'Doppio diesis' },
];

interface ToolbarProps {
  tool: Tool;
  setTool: (t: Tool) => void;
  duration: Duration;
  setDuration: (d: Duration) => void;
  previewOnCreate: boolean;
  setPreviewOnCreate: (v: boolean) => void;
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
  onLoadPiece: (id: string) => void;
}

export function Toolbar(props: ToolbarProps) {
  const {
    tool,
    setTool,
    duration,
    setDuration,
    previewOnCreate,
    setPreviewOnCreate,
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
    onLoadPiece,
  } = props;

  // Single click arms a modal tool for one use; double click makes it sticky.
  // (onClick fires for both, with e.detail telling us the click count.)
  function clickAccidental(alter: Alter, detail: number) {
    if (detail >= 2) {
      setTool({ kind: 'accidental', alter, sticky: true });
    } else if (tool.kind === 'accidental' && tool.alter === alter) {
      setTool({ kind: 'note' }); // toggle off
    } else {
      setTool({ kind: 'accidental', alter, sticky: false });
    }
  }
  function clickEraser(detail: number) {
    if (detail >= 2) {
      setTool({ kind: 'eraser', sticky: true });
    } else if (tool.kind === 'eraser') {
      setTool({ kind: 'note' });
    } else {
      setTool({ kind: 'eraser', sticky: false });
    }
  }

  const eraserClass = tool.kind === 'eraser' ? (tool.sticky ? 'on sticky' : 'on') : '';

  return (
    <div className="toolbar">
      <fieldset className="group">
        <legend>Strumento</legend>
        <div className="btn-row">
          <button className={tool.kind === 'note' ? 'on' : ''} onClick={() => setTool({ kind: 'note' })} title="Inserisci note">
            Note
          </button>
          <button
            className={eraserClass}
            onClick={(e) => clickEraser(e.detail)}
            title="Gomma — 1 click: una volta · doppio click: modalità fissa. Clicca sulla testa della nota."
          >
            ⌫ Gomma
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
          {ACCIDENTALS.map(({ alter, title }) => {
            const active = tool.kind === 'accidental' && tool.alter === alter;
            const cls = active ? (tool.sticky ? 'on sticky' : 'on') : '';
            return (
              <button
                key={alter}
                className={`glyph-btn ${cls}`}
                onClick={(e) => clickAccidental(alter, e.detail)}
                title={`${title} — 1 click: una volta · doppio click: modalità fissa`}
              >
                <span className="bravura acc">{SMUFL.accidentals[String(alter)]}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>Audio</legend>
        <div className="btn-row">
          <button
            className={previewOnCreate ? 'on' : ''}
            onClick={() => setPreviewOnCreate(!previewOnCreate)}
            title="Suona la nota appena creata (durata fissa)"
          >
            ♪ Suona nota
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
        <legend>Libreria</legend>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onLoadPiece(e.target.value);
            e.target.value = '';
          }}
          title="Carica un brano pronto da suonare"
        >
          <option value="">— scegli un brano —</option>
          {LIBRARY.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} · {p.subtitle}
            </option>
          ))}
        </select>
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
