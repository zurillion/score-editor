import { Fragment } from 'react';
import { Duration, Pitch, Staff } from '../music/types';
import { pitchToDiatonic } from '../music/theory';
import { diatonicToY, ledgerLineDiatonics, TREBLE_MIDDLE, BASS_MIDDLE } from '../music/layout';
import { SMUFL } from '../music/smufl';
import {
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
  staff: Staff;
  x: number; // notehead centre x
  color: string;
  opacity?: number;
}

/** Renders a single note or a chord (several simultaneous noteheads on one stem). */
export function NoteView({ pitches, duration, staff, x, color, opacity = 1 }: NoteViewProps) {
  if (pitches.length === 0) return null;

  const ds = pitches.map(pitchToDiatonic);
  const minD = Math.min(...ds);
  const maxD = Math.max(...ds);

  // stem direction is decided by the note's own staff, not by where the pitch sits
  const middle = staff === 'treble' ? TREBLE_MIDDLE : BASS_MIDDLE;
  const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
  const stemUp = avg < middle;

  const value = duration.value;
  const isWhole = value === 1;
  const headHW = isWhole ? 9 : 7.1; // actual Bravura notehead half-widths (so glyph centres on x)
  const headGlyph = SMUFL.noteheads[isWhole ? 1 : value === 2 ? 2 : 4];

  const nFlags = value === 8 ? 1 : value === 16 ? 2 : value === 32 ? 3 : 0;
  const stemLen = STEM_LENGTH + (nFlags > 1 ? (nFlags - 1) * STAFF_SPACE : 0);

  // attach the stem just inside the notehead edge (tangent internally)
  const stemInset = 0.8;
  const stemX = stemUp ? x + headHW - stemInset : x - headHW + stemInset;
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
            {/* open noteheads stay hollow: the staff line shows through, as in print */}
            <text x={x - headHW} y={y} fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill={color}>
              {headGlyph}
            </text>
            {p.alter !== 0 && (
              <text x={x - headHW - 3} y={y} textAnchor="end" fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill={color}>
                {SMUFL.accidentals[String(p.alter)]}
              </text>
            )}
            {Array.from({ length: duration.dots }).map((_, k) => (
              <circle key={k} cx={x + headHW + 6 + k * 5} cy={dotY} r={2.1} fill={color} />
            ))}
          </Fragment>
        );
      })}
    </g>
  );
}
