import { useRef, useState } from 'react';

export type ExportFormat = 'json' | 'musicxml';

/**
 * Export button with a press-and-hold menu: a plain click exports JSON,
 * holding the button (or right-clicking it) opens the format menu.
 */
export function ExportMenuButton({
  label,
  title,
  disabled,
  onExport,
}: {
  label: string;
  title?: string;
  disabled?: boolean;
  onExport: (format: ExportFormat) => void;
}) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef(0);
  const heldRef = useRef(false); // the long press already opened the menu: swallow the click

  const arm = () => {
    heldRef.current = false;
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      heldRef.current = true;
      setOpen(true);
    }, 450);
  };
  const disarm = () => window.clearTimeout(timerRef.current);
  const pick = (format: ExportFormat) => {
    setOpen(false);
    onExport(format);
  };

  return (
    <span className="export-split">
      <button
        disabled={disabled}
        title={`${title ? `${title}\n` : ''}Tieni premuto (o clic destro) per scegliere il formato: JSON o MusicXML.`}
        onMouseDown={arm}
        onMouseUp={disarm}
        onMouseLeave={disarm}
        onClick={() => {
          if (heldRef.current) {
            heldRef.current = false;
            return;
          }
          onExport('json');
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          disarm();
          setOpen(true);
        }}
      >
        {label}
      </button>
      {open && (
        <>
          <div className="menu-overlay" onClick={() => setOpen(false)} />
          <div className="export-menu" role="menu">
            <button role="menuitem" onClick={() => pick('json')}>
              JSON
            </button>
            <button role="menuitem" onClick={() => pick('musicxml')}>
              MusicXML
            </button>
          </div>
        </>
      )}
    </span>
  );
}
