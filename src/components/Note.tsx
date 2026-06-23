import { Fragment } from 'react';
import { Duration, Pitch, Staff } from '../music/types';
import { pitchToDiatonic } from '../music/theory';
import { diatonicToY, ledgerLineDiatonics, STEM_INSET, noteheadHalfWidth, stemUpForChord, secondOffsets } from '../music/layout';
import { keyAlterForStep } from '../music/key';
import { Resolved } from '../music/accidentals';
import { Alter } from '../music/types';
import { SMUFL } from '../music/smufl';
import { STEM_WIDTH, STEM_LENGTH, LEDGER_HALF, LEDGER_WIDTH, HALF_SPACE, STAFF_SPACE, GLYPH_FONT_SIZE } from '../music/constants';

interface NoteViewProps {
  pitches: Pitch[];
  duration: Duration;
  staff: Staff;
  keySignature?: number;
  resolve?: (step: string, octave: number) => Resolved | undefined;
  x: number; // notehead column reference x
  color: string;
  opacity?: number;
  beam?: { stemUp: boolean; tipY: number }; // when set, stem reaches the beam and no flag is drawn
}

/** Renders a single note or a chord (several noteheads on one stem). */
export function NoteView({ pitches, duration, staff, keySignature = 0, resolve, x, color, opacity = 1, beam }: NoteViewProps) {
  if (pitches.length === 0) return null;

  // noteheads low -> high
  const notes = pitches.map((p) => ({ p, d: pitchToDiatonic(p) })).sort((a, b) => a.d - b.d);
  const ds = notes.map((n) => n.d);
  const minD = ds[0];
  const maxD = ds[ds.length - 1];

  const stemUp = beam ? beam.stemUp : stemUpForChord(ds, staff);

  const value = duration.value;
  const isWhole = value === 1;
  const headHW = noteheadHalfWidth(value);
  const headGlyph = SMUFL.noteheads[isWhole ? 1 : value === 2 ? 2 : 4];

  const nFlags = beam ? 0 : value === 8 ? 1 : value === 16 ? 2 : value === 32 ? 3 : 0;
  const stemLen = STEM_LENGTH + (nFlags > 1 ? (nFlags - 1) * STAFF_SPACE : 0);

  const stemX = stemUp ? x + headHW - STEM_INSET : x - headHW + STEM_INSET;
  const baseY = stemUp ? diatonicToY(minD) : diatonicToY(maxD);
  const tipY = isWhole ? baseY : beam ? beam.tipY : stemUp ? diatonicToY(maxD) - stemLen : diatonicToY(minD) + stemLen;

  // seconds: displace one of each pair to the far side of the stem
  const offsets = secondOffsets(ds, stemUp, headHW);
  const cxOf = (i: number) => x + offsets[i];

  // augmentation dots: one aligned column to the right of the chord; a dot for a
  // note on a line sits in the space above, and collisions are nudged down.
  const dots: JSX.Element[] = [];
  if (duration.dots > 0) {
    const dotX = Math.max(...notes.map((_, i) => cxOf(i))) + headHW + 6;
    const usedY: number[] = [];
    // place from the top note down so lower dots move out of the way
    for (let i = notes.length - 1; i >= 0; i--) {
      const y = diatonicToY(ds[i]);
      let dy = ds[i] % 2 === 0 ? y - HALF_SPACE : y; // even diatonic = line -> space above
      while (usedY.some((u) => Math.abs(u - dy) < HALF_SPACE)) dy += 2 * HALF_SPACE;
      usedY.push(dy);
      for (let k = 0; k < duration.dots; k++) {
        dots.push(<circle key={`d${i}-${k}`} cx={dotX + k * 5} cy={dy} r={2.1} fill={color} />);
      }
    }
  }

  return (
    <g opacity={opacity}>
      {/* per-note ledger lines, centred on each (possibly displaced) notehead */}
      {notes.map((n, i) =>
        ledgerLineDiatonics(n.d).map((q) => {
          const cx = cxOf(i);
          const y = diatonicToY(q);
          return (
            <line key={`l${i}-${q}`} x1={cx - LEDGER_HALF} x2={cx + LEDGER_HALF} y1={y} y2={y} stroke={color} strokeWidth={LEDGER_WIDTH} />
          );
        }),
      )}

      {!isWhole && (
        <line x1={stemX} x2={stemX} y1={baseY} y2={tipY} stroke={color} strokeWidth={STEM_WIDTH} strokeLinecap="round" />
      )}

      {nFlags > 0 && (
        <text x={stemX} y={tipY} fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill={color}>
          {(stemUp ? SMUFL.flagsUp : SMUFL.flagsDown)[value]}
        </text>
      )}

      {notes.map((n, i) => {
        const cx = cxOf(i);
        const y = diatonicToY(n.d);
        return (
          <Fragment key={i}>
            {/* open noteheads stay hollow: the staff line shows through, as in print */}
            <text x={cx - headHW} y={y} fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill={color}>
              {headGlyph}
            </text>
            {(() => {
              const r = resolve?.(n.p.step, n.p.octave);
              const show = r ? r.show : n.p.alter !== keyAlterForStep(n.p.step, keySignature);
              const glyphAlter: Alter = r ? r.alter : n.p.alter;
              return show ? (
                <text x={cx - headHW - 3} y={y} textAnchor="end" fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill={color}>
                  {SMUFL.accidentals[String(glyphAlter)]}
                </text>
              ) : null;
            })()}
          </Fragment>
        );
      })}

      {dots}
    </g>
  );
}
