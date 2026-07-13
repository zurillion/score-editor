import { useEffect, useState } from 'react';
import { INSTRUMENTS } from '../music/instruments';
import { ensureAcousticKit, getLoadedAcousticKit } from '../music/drumkit';
import { PiecePlayback, StaffPlayback, defaultStaffPlayback } from '../music/playback';
import { StaffDef } from '../music/types';
import { staffLabel } from '../music/staves';
import { KEY_OPTIONS } from '../music/key';
import type { ScoreAction } from '../state/scoreReducer';

function MixerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none">
      <line x1="5" y1="3" x2="5" y2="21" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="19" y1="3" x2="19" y2="21" />
      <line x1="2.5" y1="9" x2="7.5" y2="9" />
      <line x1="9.5" y1="15" x2="14.5" y2="15" />
      <line x1="16.5" y1="6" x2="21.5" y2="6" />
    </svg>
  );
}

/**
 * Load state of the acoustic drum samples, shown beside the kit selector so a
 * missing kit is visible instead of a silent fallback to the synth. Mounting
 * (re)triggers the load, so reopening the mixer retries after a failure.
 */
function AcousticKitStatus() {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(() => (getLoadedAcousticKit() ? 'ready' : 'loading'));
  useEffect(() => {
    let alive = true;
    ensureAcousticKit()
      .then(() => alive && setState('ready'))
      .catch(() => alive && setState('error'));
    return () => {
      alive = false;
    };
  }, []);
  if (state === 'loading') return <span className="kit-status loading" title="Sto caricando i campioni acustici…">⏳</span>;
  if (state === 'error')
    return (
      <span className="kit-status error" title="Campioni acustici non disponibili: suona il kit sintetico. Riapri il mixer per riprovare.">
        ⚠ non disponibili
      </span>
    );
  return <span className="kit-status ready" title="Campioni acustici caricati: la riproduzione usa i suoni reali.">✓</span>;
}

/**
 * Per-staff mixer & staff manager: instrument (specific wins over the general
 * one), volume, transpose, mute/solo and visibility per staff, per-staff
 * clef/key for the extra staves, buttons to add/remove staves or whole grand
 * staves, and drag-to-reorder (a grand pair moves as one unit). With
 * manage=false (the listen-only page) only the audio controls are shown:
 * instrument, volume, transpose, M/S.
 */
export function MixerPanel({
  open,
  onToggle,
  playback,
  onChange,
  staves,
  onScoreAction = () => {},
  manage = true,
}: {
  open: boolean;
  onToggle: () => void;
  playback: PiecePlayback;
  onChange: (pb: PiecePlayback) => void;
  staves: StaffDef[];
  onScoreAction?: (a: ScoreAction) => void;
  manage?: boolean;
}) {
  const staffOf = (id: string): StaffPlayback => playback.staves[id] ?? defaultStaffPlayback();
  const patchStaff = (id: string, patch: Partial<StaffPlayback>) =>
    onChange({ ...playback, staves: { ...playback.staves, [id]: { ...staffOf(id), ...patch } } });

  const customized =
    playback.transpose !== 0 ||
    staves.some((s) => {
      const st = staffOf(s.id);
      return st.instrument || st.volume !== 100 || st.transpose !== 0 || st.mute || st.solo || !!st.midiChannel;
    });

  const visibleCount = staves.filter((s) => !s.hidden).length;

  // drag-to-reorder works on UNITS: a single staff, or a grand pair (linked)
  const units: StaffDef[][] = [];
  for (const def of staves) {
    const prev = units[units.length - 1];
    if (prev && def.group && prev[0].group === def.group && prev.length < 2) prev.push(def);
    else units.push([def]);
  }
  const [dragUi, setDragUi] = useState<number | null>(null);
  const [overUi, setOverUi] = useState<number | null>(null);
  const endDrag = () => {
    setDragUi(null);
    setOverUi(null);
  };
  const dropOnUnit = (ui: number) => {
    if (dragUi !== null && dragUi !== ui) {
      const next = units.slice();
      const [moved] = next.splice(dragUi, 1);
      next.splice(ui, 0, moved);
      onScoreAction({ type: 'REORDER_STAVES', order: next.flat().map((s) => s.id) });
    }
    endDrag();
  };

  const staffRow = (def: StaffDef) => {
    const st = staffOf(def.id);
    return (
      <div className={`mixer-row ${def.hidden ? 'dim' : ''}`} key={def.id}>
        {manage ? (
          <label className="mixer-show" title="Mostra o nasconde il pentagramma nello spartito (nascosto continua a suonare)">
            <input
              type="checkbox"
              checked={!def.hidden}
              disabled={!def.hidden && visibleCount <= 1}
              onChange={(e) => onScoreAction({ type: 'UPDATE_STAFF', id: def.id, patch: { hidden: !e.target.checked } })}
            />
            <strong>{staffLabel(staves, def)}</strong>
          </label>
        ) : (
          <span className="mixer-show">
            <strong>{staffLabel(staves, def)}</strong>
          </span>
        )}
        <span className="mixer-ms">
          <button
            className={st.mute ? 'ms-on mute' : ''}
            onClick={() => patchStaff(def.id, { mute: !st.mute })}
            title="Mute — ammutolisce il rigo"
            aria-label={`Mute ${staffLabel(staves, def)}`}
          >
            M
          </button>
          <button
            className={st.solo ? 'ms-on solo' : ''}
            onClick={() => patchStaff(def.id, { solo: !st.solo })}
            title="Solo — suona solo questo rigo (più S premuti: suonano tutti gli S)"
            aria-label={`Solo ${staffLabel(staves, def)}`}
          >
            S
          </button>
        </span>
        {def.clef === 'percussion' ? (
          <label title="Kit di batteria: sintetico (offline) o acustico campionato (si scarica al primo uso)">
            Batteria
            <select
              value={def.drumKit === 'acoustic' ? 'acoustic' : 'synth'}
              onChange={(e) => onScoreAction({ type: 'UPDATE_STAFF', id: def.id, patch: { drumKit: e.target.value === 'acoustic' ? 'acoustic' : 'synth' } })}
              disabled={!manage}
            >
              <option value="synth">Sintetico</option>
              <option value="acoustic">Acustico (campioni)</option>
            </select>
            {def.drumKit === 'acoustic' && <AcousticKitStatus />}
          </label>
        ) : (
          <label>
            Strumento
            <select value={st.instrument} onChange={(e) => patchStaff(def.id, { instrument: e.target.value })}>
              <option value="">— (generale)</option>
              {INSTRUMENTS.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Volume
          <span className="mixer-slider">
            <input type="range" min={0} max={100} step={5} value={st.volume} onChange={(e) => patchStaff(def.id, { volume: Number(e.target.value) })} />
            <span className="mixer-value">{st.volume}%</span>
          </span>
        </label>
        <label title="Semitoni: es. +12 per un basso notato un'ottava sopra, -2 per un clarinetto in Si♭">
          Traspos.
          <span className="mixer-slider">
            <input type="number" min={-48} max={48} step={1} value={st.transpose} onChange={(e) => patchStaff(def.id, { transpose: Math.max(-48, Math.min(48, Number(e.target.value) || 0)) })} />
            <span className="mixer-value">st</span>
          </span>
        </label>
        {manage && (
          <label title="Canale MIDI del rigo per l'uscita MIDI esterna; '—' usa il canale generale impostato nel gruppo MIDI">
            Can. MIDI
            <select
              value={st.midiChannel ?? ''}
              onChange={(e) => {
                const { midiChannel: _drop, ...rest } = staffOf(def.id);
                onChange({ ...playback, staves: { ...playback.staves, [def.id]: e.target.value === '' ? rest : { ...rest, midiChannel: Number(e.target.value) } } });
              }}
            >
              <option value="">—</option>
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
        )}
        {manage && !def.group && def.clef !== 'percussion' && (
          <label title="Chiave del pentagramma">
            Chiave
            <select value={def.clef} onChange={(e) => onScoreAction({ type: 'UPDATE_STAFF', id: def.id, patch: { clef: e.target.value === 'bass' ? 'bass' : 'treble' } })}>
              <option value="treble">violino 𝄞</option>
              <option value="bass">basso 𝄢</option>
            </select>
          </label>
        )}
        {manage && def.clef !== 'percussion' && (
          <label title="Armatura di chiave del rigo: '= brano' segue la tonalità del brano (e i suoi cambi)">
            Tonalità
            <select
              value={def.key === null || def.key === undefined ? '' : String(def.key)}
              onChange={(e) => onScoreAction({ type: 'UPDATE_STAFF', id: def.id, patch: { key: e.target.value === '' ? null : Number(e.target.value) } })}
            >
              <option value="">= brano</option>
              {KEY_OPTIONS.map((k) => (
                <option key={k.value} value={String(k.value)}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {manage && (
          <button
            className="mixer-remove"
            disabled={staves.length <= 1}
            onClick={() => {
              if (window.confirm(`Rimuovere "${staffLabel(staves, def)}"?\nLe note su questo rigo verranno eliminate.`)) {
                onScoreAction({ type: 'REMOVE_STAFF', id: def.id });
              }
            }}
            title="Rimuove il pentagramma e tutte le sue note"
            aria-label={`Rimuovi ${staffLabel(staves, def)}`}
          >
            ✕
          </button>
        )}
      </div>
    );
  };

  return (
    <span className="export-split">
      <button
        className={`icon-btn ${customized ? 'on' : ''}`}
        onClick={onToggle}
        title="Mixer e righi — strumento, volume, trasposizione e visibilità per ogni rigo; aggiungi, togli o riordina i pentagrammi (lo strumento specifico ha priorità su quello generale)"
        aria-label="Mixer"
      >
        <MixerIcon />
      </button>
      {open && (
        <>
          <div className="menu-overlay" onClick={onToggle} />
          <div className="mixer-panel">
            {manage && (
              <div className="mixer-add">
                <span>Sopra:</span>
                <button onClick={() => onScoreAction({ type: 'ADD_STAFF', where: 'above', clef: 'treble' })} title="Aggiunge un pentagramma sopra">+ Rigo</button>
                <button onClick={() => onScoreAction({ type: 'ADD_STAFF', where: 'above', clef: 'treble', grand: true })} title="Aggiunge un endecalineo (due righi con graffa) sopra">+ Endecalineo</button>
                <span className="mixer-add-sep">Sotto:</span>
                <button onClick={() => onScoreAction({ type: 'ADD_STAFF', where: 'below', clef: 'bass' })} title="Aggiunge un pentagramma sotto">+ Rigo</button>
                <button onClick={() => onScoreAction({ type: 'ADD_STAFF', where: 'below', clef: 'treble', grand: true })} title="Aggiunge un endecalineo (due righi con graffa) sotto">+ Endecalineo</button>
                <button onClick={() => onScoreAction({ type: 'ADD_STAFF', where: 'below', clef: 'percussion' })} title="Aggiunge un rigo di batteria (percussione) sotto">+ Batteria</button>
              </div>
            )}
            {units.map((unit, ui) => (
              <div
                key={unit[0].id}
                className={`mixer-unit ${dragUi === ui ? 'dragging' : ''} ${overUi === ui && dragUi !== null && dragUi !== ui ? (ui < dragUi ? 'drop-above' : 'drop-below') : ''}`}
                onDragOver={manage ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overUi !== ui) setOverUi(ui); } : undefined}
                onDragLeave={manage ? () => setOverUi((o) => (o === ui ? null : o)) : undefined}
                onDrop={manage ? (e) => { e.preventDefault(); dropOnUnit(ui); } : undefined}
              >
                {manage && (
                  <span
                    className="mixer-drag"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', String(ui));
                      e.dataTransfer.effectAllowed = 'move';
                      setDragUi(ui);
                    }}
                    onDragEnd={endDrag}
                    title={unit.length === 2 ? "Trascina per riordinare — i due righi dell'endecalineo si spostano insieme" : 'Trascina per riordinare i pentagrammi'}
                    aria-label={`Riordina ${staffLabel(staves, unit[0])}`}
                  >
                    ⋮⋮
                  </span>
                )}
                <div className="mixer-unit-rows">{unit.map(staffRow)}</div>
              </div>
            ))}
            <div className="mixer-row general">
              <strong>Generale</strong>
              <label title="Semitoni aggiunti alla trasposizione di ogni rigo">
                Trasposizione
                <span className="mixer-slider">
                  <input
                    type="number"
                    min={-48}
                    max={48}
                    step={1}
                    value={playback.transpose}
                    onChange={(e) => onChange({ ...playback, transpose: Math.max(-48, Math.min(48, Number(e.target.value) || 0)) })}
                  />
                  <span className="mixer-value">st</span>
                </span>
              </label>
            </div>
          </div>
        </>
      )}
    </span>
  );
}
