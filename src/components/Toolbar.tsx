import { Duration, DurationValue, Alter, TimeSignature } from '../music/types';
import { SMUFL } from '../music/smufl';
import { LayoutMode } from '../music/layout';
import { Tool } from '../state/tool';
import { LIBRARY } from '../music/library';
import { KEY_OPTIONS } from '../music/key';
import { MidiOutputInfo } from '../music/midi';
import { INSTRUMENTS } from '../music/instruments';
import { InstrumentIcon } from './InstrumentIcon';

const DURATIONS: DurationValue[] = [1, 2, 4, 8, 16, 32];

const TIME_PRESETS: TimeSignature[] = [
  { numerator: 2, denominator: 4 },
  { numerator: 3, denominator: 4 },
  { numerator: 4, denominator: 4 },
  { numerator: 5, denominator: 4 },
  { numerator: 7, denominator: 4 },
  { numerator: 3, denominator: 8 },
  { numerator: 5, denominator: 8 },
  { numerator: 6, denominator: 8 },
  { numerator: 7, denominator: 8 },
  { numerator: 9, denominator: 8 },
  { numerator: 11, denominator: 8 },
  { numerator: 12, denominator: 8 },
  { numerator: 13, denominator: 8 },
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
  hoverNote: string | null;
  previewOnCreate: boolean;
  setPreviewOnCreate: (v: boolean) => void;
  measureLabel: string;
  hasPickup: boolean;
  onToggleAnacrusis: () => void;
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
  instrument: string;
  setInstrument: (id: string) => void;
  instrumentLoading: boolean;
  midiOn: boolean;
  onToggleMidi: () => void;
  midiOutputs: MidiOutputInfo[];
  midiOutId: string;
  setMidiOutId: (id: string) => void;
  midiChannel: number;
  setMidiChannel: (n: number) => void;
  isPlaying: boolean;
  onPlay: () => void;
  onStop: () => void;
  onToStart: () => void;
  onAddMeasure: () => void;
  onRemoveMeasure: () => void;
  onClear: () => void;
  onLoadPiece: (id: string) => void;
  onInsertMeasures: () => void;
  onSaveFile: () => void;
  onLoadFile: () => void;
  onOpenOptions: () => void;
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v2.6M12 18.9v2.6M21.5 12h-2.6M5.1 12H2.5M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8M18.7 18.7l-1.8-1.8M7.1 7.1L5.3 5.3" />
    </svg>
  );
}

export function Toolbar(props: ToolbarProps) {
  const {
    tool,
    setTool,
    duration,
    setDuration,
    hoverNote,
    previewOnCreate,
    setPreviewOnCreate,
    measureLabel,
    hasPickup,
    onToggleAnacrusis,
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
    instrument,
    setInstrument,
    instrumentLoading,
    midiOn,
    onToggleMidi,
    midiOutputs,
    midiOutId,
    setMidiOutId,
    midiChannel,
    setMidiChannel,
    isPlaying,
    onPlay,
    onStop,
    onToStart,
    onAddMeasure,
    onRemoveMeasure,
    onClear,
    onLoadPiece,
    onInsertMeasures,
    onSaveFile,
    onLoadFile,
    onOpenOptions,
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
  function clickDot(dots: 1 | 2, detail: number) {
    if (detail >= 2) setTool({ kind: 'dot', dots, sticky: true });
    else if (tool.kind === 'dot' && tool.dots === dots) setTool({ kind: 'note' });
    else setTool({ kind: 'dot', dots, sticky: false });
  }
  function clickTuplet(detail: number) {
    if (detail >= 2) setTool({ kind: 'tuplet', sticky: true });
    else if (tool.kind === 'tuplet') setTool({ kind: 'note' });
    else setTool({ kind: 'tuplet', sticky: false });
  }
  function clickTie(detail: number) {
    if (detail >= 2) setTool({ kind: 'tie', sticky: true });
    else if (tool.kind === 'tie') setTool({ kind: 'note' });
    else setTool({ kind: 'tie', sticky: false });
  }

  const eraserClass = tool.kind === 'eraser' ? (tool.sticky ? 'on sticky' : 'on') : '';
  const tupletClass = tool.kind === 'tuplet' ? (tool.sticky ? 'on sticky' : 'on') : '';
  const tieClass = tool.kind === 'tie' ? (tool.sticky ? 'on sticky' : 'on') : '';

  return (
    <div className="toolbar">
      <button className="gear-btn" onClick={onOpenOptions} title="Opzioni" aria-label="Opzioni">
        <GearIcon />
      </button>
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
        <legend>Nota</legend>
        <div className="note-readout" title="Nota che verrebbe inserita (armatura e alterazioni della battuta incluse)">
          {hoverNote ?? '—'}
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>Punti</legend>
        <div className="btn-row">
          {([1, 2] as const).map((n) => {
            const active = tool.kind === 'dot' && tool.dots === n;
            const cls = active ? (tool.sticky ? 'on sticky' : 'on') : '';
            return (
              <button
                key={n}
                className={cls}
                onClick={(e) => clickDot(n, e.detail)}
                title={`Punto${n === 2 ? ' doppio' : ''} — 1 click: una volta · doppio click: modalità fissa. Clicca sulla nota.`}
              >
                {'•'.repeat(n)}
              </button>
            );
          })}
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
            className={tupletClass}
            onClick={(e) => clickTuplet(e.detail)}
            title="Terzina — clicca su una nota per trasformarla in una terzina (3 note nel tempo di 2). 1 click: una volta · doppio click: fissa."
          >
            ³ Terzina
          </button>
          <button
            className={tieClass}
            onClick={(e) => clickTie(e.detail)}
            title="Legatura di valore — clicca una nota per legarla alla successiva della stessa altezza (anche tra battute). 1 click: una volta · doppio click: fissa."
          >
            ⌣ Legatura
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
        <legend>Tempo · {measureLabel}</legend>
        <select
          value={`${timeSignature.numerator}/${timeSignature.denominator}`}
          onChange={(e) => {
            const [n, d] = e.target.value.split('/').map(Number);
            setTimeSignature({ numerator: n, denominator: d });
            e.currentTarget.blur(); // give focus back so arrow keys still move the playhead
          }}
          title={`Tempo da ${measureLabel} in poi`}
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
        <legend>Armatura · {measureLabel}</legend>
        <select
          value={keySignature}
          onChange={(e) => {
            setKeySignature(Number(e.target.value));
            e.currentTarget.blur();
          }}
          title={`Tonalità da ${measureLabel} in poi`}
        >
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
        <legend>File</legend>
        <div className="btn-row">
          <button onClick={onSaveFile} title="Salva il brano come file .json">⤓ Salva</button>
          <button onClick={onLoadFile} title="Carica un brano da un file .json">⤒ Carica</button>
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>Libreria</legend>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onLoadPiece(e.target.value);
            e.target.value = '';
            e.currentTarget.blur();
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
          <button
            className={hasPickup ? 'on' : ''}
            onClick={onToggleAnacrusis}
            title="Anacrusi (battuta in levare): battuta iniziale incompleta che si adatta alle note"
          >
            ⅃ Anacrusi
          </button>
        </div>
      </fieldset>

      <fieldset className="group transport">
        <legend>Playback{instrumentLoading ? ' · carico strumento…' : ''}</legend>
        <div className="btn-row">
          <button onClick={onToStart} title="Torna all'inizio del brano" aria-label="Torna all'inizio">
            ⏮
          </button>
          <button className={`play ${isPlaying ? 'stop' : ''}`} onClick={isPlaying ? onStop : onPlay}>
            {isPlaying ? '■ Stop' : '▶ Play'}
          </button>
          <label className="instrument" title="Strumento usato dal playback (i campioni si scaricano al primo uso)">
            <InstrumentIcon id={instrument} />
            <select
              value={instrument}
              onChange={(e) => {
                setInstrument(e.target.value);
                e.currentTarget.blur();
              }}
              disabled={isPlaying}
              aria-label="Strumento"
            >
              {INSTRUMENTS.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
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
            onMouseUp={(e) => e.currentTarget.blur()}
            aria-label="BPM"
          />
        </div>
      </fieldset>

      <fieldset className="group">
        <legend>MIDI</legend>
        <div className="btn-row">
          <button
            className={midiOn ? 'on' : ''}
            onClick={onToggleMidi}
            title="Pilota un dispositivo/synth MIDI esterno via Web MIDI (Chrome/Edge)"
          >
            🎹 MIDI {midiOn ? 'on' : 'off'}
          </button>
          <label className="midi-out">
            Uscita
            <select
              value={midiOutId}
              onChange={(e) => {
                setMidiOutId(e.target.value);
                e.currentTarget.blur();
              }}
              disabled={!midiOn || midiOutputs.length === 0}
              title="Uscita MIDI"
            >
              {midiOutputs.length === 0 && <option value="">—</option>}
              {midiOutputs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="midi-ch">
            Canale
            <select
              value={midiChannel}
              onChange={(e) => {
                setMidiChannel(Number(e.target.value));
                e.currentTarget.blur();
              }}
              title="Canale MIDI (1-16)"
            >
              {Array.from({ length: 16 }, (_, i) => i + 1).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>
    </div>
  );
}
