import { INSTRUMENTS } from '../music/instruments';
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
 * Per-staff mixer & staff manager: instrument (specific wins over the general
 * one), volume, transpose and visibility per staff, per-staff clef/key for the
 * extra staves, plus buttons to add/remove staves or whole grand staves.
 */
export function MixerPanel({
  open,
  onToggle,
  playback,
  onChange,
  staves,
  onScoreAction,
}: {
  open: boolean;
  onToggle: () => void;
  playback: PiecePlayback;
  onChange: (pb: PiecePlayback) => void;
  staves: StaffDef[];
  onScoreAction: (a: ScoreAction) => void;
}) {
  const staffOf = (id: string): StaffPlayback => playback.staves[id] ?? defaultStaffPlayback();
  const patchStaff = (id: string, patch: Partial<StaffPlayback>) =>
    onChange({ ...playback, staves: { ...playback.staves, [id]: { ...staffOf(id), ...patch } } });

  const customized =
    playback.transpose !== 0 ||
    staves.some((s) => {
      const st = staffOf(s.id);
      return st.instrument || st.volume !== 100 || st.transpose !== 0;
    });

  const visibleCount = staves.filter((s) => !s.hidden).length;

  return (
    <span className="export-split">
      <button
        className={`icon-btn ${customized ? 'on' : ''}`}
        onClick={onToggle}
        title="Mixer e righi — strumento, volume, trasposizione e visibilità per ogni rigo; aggiungi o togli pentagrammi (lo strumento specifico ha priorità su quello generale)"
        aria-label="Mixer"
      >
        <MixerIcon />
      </button>
      {open && (
        <>
          <div className="menu-overlay" onClick={onToggle} />
          <div className="mixer-panel">
            <div className="mixer-add">
              <span>Sopra:</span>
              <button onClick={() => onScoreAction({ type: 'ADD_STAFF', where: 'above', clef: 'treble' })} title="Aggiunge un pentagramma sopra">+ Rigo</button>
              <button onClick={() => onScoreAction({ type: 'ADD_STAFF', where: 'above', clef: 'treble', grand: true })} title="Aggiunge un endecalineo (due righi con graffa) sopra">+ Endecalineo</button>
              <span className="mixer-add-sep">Sotto:</span>
              <button onClick={() => onScoreAction({ type: 'ADD_STAFF', where: 'below', clef: 'bass' })} title="Aggiunge un pentagramma sotto">+ Rigo</button>
              <button onClick={() => onScoreAction({ type: 'ADD_STAFF', where: 'below', clef: 'treble', grand: true })} title="Aggiunge un endecalineo (due righi con graffa) sotto">+ Endecalineo</button>
            </div>
            {staves.map((def) => {
              const st = staffOf(def.id);
              return (
                <div className={`mixer-row ${def.hidden ? 'dim' : ''}`} key={def.id}>
                  <label className="mixer-show" title="Mostra o nasconde il pentagramma nello spartito (nascosto continua a suonare)">
                    <input
                      type="checkbox"
                      checked={!def.hidden}
                      disabled={!def.hidden && visibleCount <= 1}
                      onChange={(e) => onScoreAction({ type: 'UPDATE_STAFF', id: def.id, patch: { hidden: !e.target.checked } })}
                    />
                    <strong>{staffLabel(staves, def)}</strong>
                  </label>
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
                  {!def.group && (
                    <label title="Chiave del pentagramma">
                      Chiave
                      <select value={def.clef} onChange={(e) => onScoreAction({ type: 'UPDATE_STAFF', id: def.id, patch: { clef: e.target.value === 'bass' ? 'bass' : 'treble' } })}>
                        <option value="treble">violino 𝄞</option>
                        <option value="bass">basso 𝄢</option>
                      </select>
                    </label>
                  )}
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
                </div>
              );
            })}
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
