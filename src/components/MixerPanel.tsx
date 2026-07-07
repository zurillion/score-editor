import { INSTRUMENTS } from '../music/instruments';
import { PiecePlayback, STAFF_IDS, STAFF_LABELS, StaffPlayback, defaultStaffPlayback } from '../music/playback';

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
 * Per-staff mixer: instrument (specific wins over the general one), volume
 * and transpose per staff, plus a general transpose added to every staff.
 */
export function MixerPanel({
  open,
  onToggle,
  playback,
  onChange,
}: {
  open: boolean;
  onToggle: () => void;
  playback: PiecePlayback;
  onChange: (pb: PiecePlayback) => void;
}) {
  const staffOf = (id: string): StaffPlayback => playback.staves[id] ?? defaultStaffPlayback();
  const patchStaff = (id: string, patch: Partial<StaffPlayback>) =>
    onChange({ ...playback, staves: { ...playback.staves, [id]: { ...staffOf(id), ...patch } } });

  const customized =
    playback.transpose !== 0 || STAFF_IDS.some((s) => staffOf(s).instrument || staffOf(s).volume !== 100 || staffOf(s).transpose !== 0);

  return (
    <span className="export-split">
      <button
        className={`icon-btn ${customized ? 'on' : ''}`}
        onClick={onToggle}
        title="Mixer — strumento, volume e trasposizione per ogni rigo (lo strumento specifico ha priorità su quello generale)"
        aria-label="Mixer"
      >
        <MixerIcon />
      </button>
      {open && (
        <>
          <div className="menu-overlay" onClick={onToggle} />
          <div className="mixer-panel">
            {STAFF_IDS.map((id) => {
              const st = staffOf(id);
              return (
                <div className="mixer-row" key={id}>
                  <strong>{STAFF_LABELS[id] ?? id}</strong>
                  <label>
                    Strumento
                    <select value={st.instrument} onChange={(e) => patchStaff(id, { instrument: e.target.value })}>
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
                      <input type="range" min={0} max={100} step={5} value={st.volume} onChange={(e) => patchStaff(id, { volume: Number(e.target.value) })} />
                      <span className="mixer-value">{st.volume}%</span>
                    </span>
                  </label>
                  <label title="Semitoni: es. +12 per un basso notato un'ottava sopra, -2 per un clarinetto in Si♭">
                    Traspos.
                    <span className="mixer-slider">
                      <input type="number" min={-48} max={48} step={1} value={st.transpose} onChange={(e) => patchStaff(id, { transpose: Math.max(-48, Math.min(48, Number(e.target.value) || 0)) })} />
                      <span className="mixer-value">st</span>
                    </span>
                  </label>
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
