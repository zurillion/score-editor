import { Fragment } from 'react';
import { Duration, Pitch } from '../music/types';
import { pitchToDiatonic } from '../music/theory';
import { diatonicToY, ledgerLineDiatonics, TREBLE_MIDDLE, BASS_MIDDLE } from '../music/layout';
import { SMUFL } from '../music/smufl';
import {
  NOTEHEAD_RX,
  NOTEHEAD_RY,
  WHOLE_RX,
  STEM_WIDTH,
  STEM_LENGTH,
  LEDGER_HALF,
  LEDGER_WIDTH,
  HALF_SPACE,
  STAFF_SPACE,
  GLYPH_FONT_SIZE,
} from '../music/constants';

interface NoteViewProps {
  pitches: Pitch[];
  duration: Duration;
  x: number; // notehead centre x
  color: string;
  opacity?: number;
}

/** Renders a single note or a chord (several simultaneous noteheads on one stem). */
export function NoteView({ pitches, duration, x, color, opacity = 1 }: NoteViewProps) {
  if (pitches.length === 0) return null;

  const ds = pitches.map(pitchToDiatonic);
  const minD = Math.min(...ds);
  const maxD = Math.max(...ds);
  const avg = ds.reduce((a, b) => a + b, 0) / ds.length;

  const middle = avg >= 28 ? TREBLE_MIDDLE : BASS_MIDDLE;
  const stemUp = avg < middle;

  const value = duration.value;
  const isWhole = value === 1;
  const isOpen = value <= 2; // whole + half use open noteheads
  const rx = isWhole ? WHOLE_RX : NOTEHEAD_RX;
  const ry = NOTEHEAD_RY;

  const nFlags = value === 8 ? 1 : value === 16 ? 2 : value === 32 ? 3 : 0;
  const stemLen = STEM_LENGTH + (nFlags > 1 ? (nFlags - 1) * STAFF_SPACE : 0);

  const stemX = stemUp ? x + rx : x - rx;
  const baseY = stemUp ? diatonicToY(minD) : diatonicToY(maxD);
  const tipY = isWhole ? baseY : stemUp ? diatonicToY(maxD) - stemLen : diatonicToY(minD) + stemLen;

  const ledgers = Array.from(new Set(ds.flatMap(ledgerLineDiatonics)));

  return (
    <g opacity={opacity}>
      {ledgers.map((q) => {
        const y = diatonicToY(q);
        return (
          <line key={`l${q}`} x1={x - LEDGER_HALF} x2={x + LEDGER_HALF} y1={y} y2={y} stroke={color} strokeWidth={LEDGER_WIDTH} />
        );
      })}

      {!isWhole && (
        <line x1={stemX} x2={stemX} y1={baseY} y2={tipY} stroke={color} strokeWidth={STEM_WIDTH} strokeLinecap="round" />
      )}

      {nFlags > 0 && (
        <text x={stemX} y={tipY} fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill={color}>
          {(stemUp ? SMUFL.flagsUp : SMUFL.flagsDown)[value]}
        </text>
      )}

      {pitches.map((p, i) => {
        const d = ds[i];
        const y = diatonicToY(d);
        const dotY = d % 2 === 0 ? y - HALF_SPACE : y;
        return (
          <Fragment key={i}>
            <ellipse
              cx={x}
              cy={y}
              rx={rx}
              ry={ry}
              transform={isOpen ? undefined : `rotate(-20 ${x} ${y})`}
              fill={isOpen ? 'white' : color}
              stroke={isOpen ? color : 'none'}
              strokeWidth={isOpen ? 1.6 : 0}
            />
            {p.alter !== 0 && (
              <text x={x - rx - 3} y={y} textAnchor="end" fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill={color}>
                {SMUFL.accidentals[String(p.alter)]}
              </text>
            )}
            {Array.from({ length: duration.dots }).map((_, k) => (
              <circle key={k} cx={x + rx + 6 + k * 5} cy={dotY} r={2.1} fill={color} />
            ))}
          </Fragment>
        );
      })}
    </g>
  );
}
