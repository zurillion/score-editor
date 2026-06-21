import { Duration, DurationValue, Alter, TimeSignature } from '../music/types';
import { SMUFL } from '../music/smufl';
import { LayoutMode } from '../music/layout';
import { Tool } from '../state/tool';
import { LIBRARY } from '../music/library';
import { KEY_OPTIONS } from '../music/key';

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

function MeasureIcon() {
  return (
    <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1.4" fill="none">
        <line x1="2.5" y1="2" x2="2.5" y2="14" />
        <line x1="19.5" y1="2" x2="19.5" y2="14" />
      </g>
      <g stroke="currentColor" strokeWidth="0.8" opacity="0.85">
        <line x1="2.5" y1="4" x2="19.5" y2="4" />
        <line x1="2.5" y1="8" x2="19.5" y2="8" />
        <line x1="2.5" y1="12" x2="19.5" y2="12" />
      </g>
    </svg>
  );
}

function LassoIcon() {
  return (
    <svg width="20" height="19" viewBox="0 0 20 19" aria-hidden="true" focusable="false" fill="none" stroke="currentColor">
      <ellipse cx="10" cy="6.5" rx="7" ry="4.5" strokeWidth="1.3" strokeDasharray="2.2 1.7" />
      <path d="M9 11 C 8 13.5, 6.5 14.5, 6 17.5" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="6" cy="17.6" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

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
  keySignature: number;
  setKeySignature: (k: number) => void;
  mode: LayoutMode;
  setMode: (m: LayoutMode) => void;
  bpm: number;
  setBpm: (n: number) => void;
  loop: boolean;
  setLoop: (v: boolean) => void;
  isPlaying: boolean;
  onPlay: () => void;
  onStop: () => void;
  onAddMeasure: () => void;
  onRemoveMeasure: () => void;
  onClear: () => void;
  onLoadPiece: (id: string) => void;
  onInsertMeasures: () => void;
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
    keySignature,
    setKeySignature,
    mode,
    setMode,
    bpm,
    setBpm,
    loop,
    setLoop,
    isPlaying,
    onPlay,
    onStop,
    onAddMeasure,
    onRemoveMeasure,
    onClear,
    onLoadPiece,
    onInsertMeasures,
  } = props;

  // Single click arms a modal tool for one use; double click makes it sticky.
  function clickAccidental(alter: Alter, detail: number) {
    if (detail >= 2) setTool({ kind: 'accidental', alter, sticky: true });
    else if (tool.kind === 'accidental' && tool.alter === alter) setTool({ kind: 'note' });
    else setTool({ kind: 'accidental', alter, sticky: false });
  }
  function clickEraser(detail: number) {
    if (detail >= 2) setTool({ kind: 'eraser', sticky: true });
    else if (tool.kind === 'eraser') setTool({ kind: 'note' });
    else setTool({ kind: 'eraser', sticky: false });
  }

  const eraserClass = tool.kind === 'eraser' ? (tool.sticky ? 'on sticky' : 'on') : '';

  return (
    <div className="toolbar">
      <fieldset className="group">
        <legend>Note / Pause</legend>
        <div className="palette">
          <div className="btn-row">
            {DURATIONS.map((v) => (
              <button
                key={`n${v}`}
                className={`glyph-btn ${tool.kind === 'note' && duration.value === v ? 'on' : ''}`}
                onClick={() => {
                  setTool({ kind: 'note' });
                  setDuration({ ...duration, value: v });
                }}
                title="Nota"
              >
                <span className="bravura note">{SMUFL.paletteNotes[v]}</span>
              </button>
            ))}
          </div>
          <div className="btn-row">
            {DURATIONS.map((v) => (
              <button
                key={`r${v}`}
                className={`glyph-btn ${tool.kind === 'rest' && duration.value === v ? 'on' : ''}`}
                onClick={() => {
                  setTool({ kind: 'rest' });
                  setDuration({ ...duration, value: v });
                }}
                title="Pausa"
              >
                <span className="bravura rest">{SMUFL.rests[v]}</span>
              </button>
            ))}
          </div>
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
        <legend>Strumenti</legend>
        <div className="btn-row">
          <button
            className={eraserClass}
            onClick={(e) => clickEraser(e.detail)}
            title="Gomma — 1 click: una volta · doppio click: modalità fissa. Clicca sulla testa della nota."
          >
            ⌫ Gomma
          </button>
          <button
            className={`icon-btn ${tool.kind === 'select-measures' ? 'on' : ''}`}
            onClick={() => setTool({ kind: 'select-measures' })}
            title="Seleziona battute (trascina). ⌘C/X copia/taglia · Backspace elimina"
            aria-label="Seleziona battute"
          >
            <MeasureIcon />
          </button>
          <button onClick={onInsertMeasures} title="Inserisci battute vuote al punto di playback" aria-label="Inserisci battute">
            +
          </button>
          <button
            className={`icon-btn ${tool.kind === 'select-notes' ? 'on' : ''}`}
            onClick={() => setTool({ kind: 'select-notes' })}
            title="Lazo: seleziona note (trascina un rettangolo). ⌘C/X · Backspace"
            aria-label="Lazo note"
          >
            <LassoIcon />
          </button>
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
        <legend>Armatura</legend>
        <select value={keySignature} onChange={(e) => setKeySignature(Number(e.target.value))} title="Numero di diesis/bemolli o tonalità">
          {KEY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
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
          <button className={loop ? 'on' : ''} onClick={() => setLoop(!loop)} title="Ripeti il brano in loop">
            ↻ Loop
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
