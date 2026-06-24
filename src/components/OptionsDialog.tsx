interface OptionsDialogProps {
  open: boolean;
  onClose: () => void;
  diagonalBeams: boolean;
  setDiagonalBeams: (v: boolean) => void;
  loopSkipAnacrusis: boolean;
  setLoopSkipAnacrusis: (v: boolean) => void;
}

/** Modal window for application options. Add new options to the list below. */
export function OptionsDialog({ open, onClose, diagonalBeams, setDiagonalBeams, loopSkipAnacrusis, setLoopSkipAnacrusis }: OptionsDialogProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Opzioni" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Opzioni</h2>
          <button className="modal-close" onClick={onClose} aria-label="Chiudi">
            ✕
          </button>
        </header>

        <div className="modal-body">
          <label className="option-row">
            <input type="checkbox" checked={diagonalBeams} onChange={(e) => setDiagonalBeams(e.target.checked)} />
            <span>
              <strong>Travature diagonali</strong>
              <small>Le travature seguono l'andamento delle note (inclinate) invece di restare orizzontali.</small>
            </span>
          </label>

          <label className="option-row">
            <input type="checkbox" checked={loopSkipAnacrusis} onChange={(e) => setLoopSkipAnacrusis(e.target.checked)} />
            <span>
              <strong>Anacrusi solo alla prima ripetizione</strong>
              <small>Nel loop, l'anacrusi (battuta in levare) viene suonata solo la prima volta: le ripetizioni ripartono dalla prima battuta intera.</small>
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
