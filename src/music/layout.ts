import { Measure, Staff, TimeSignature } from './types';
import { measureTicks } from './theory';
import { HALF_SPACE, Y_MIDDLE_C, HEADER_WIDTH, MEASURE_PAD, PX_PER_TICK } from './constants';

// ---- Vertical mapping (diatonic position <-> y) ----
export function diatonicToY(d: number): number {
  return Y_MIDDLE_C - (d - 28) * HALF_SPACE;
}
export function yToDiatonic(y: number): number {
  return Math.round((Y_MIDDLE_C - y) / HALF_SPACE) + 28;
}

// Staff lines as diatonic positions (top -> bottom).
export const TREBLE_LINES = [38, 36, 34, 32, 30]; // F5 D5 B4 G4 E4
export const BASS_LINES = [26, 24, 22, 20, 18]; // A3 F3 D3 B2 G2
export const TREBLE_MIDDLE = 34; // B4
export const BASS_MIDDLE = 22; // D3
export const STAFF_TOP_DIATONIC = 38;
export const STAFF_BOTTOM_DIATONIC = 18;

// ---- Notehead geometry & chord rules ----
export const STEM_INSET = 0.8; // how far the stem sits inside the notehead edge

/** Actual Bravura notehead half-widths (so a glyph centres on its x). */
export function noteheadHalfWidth(value: number): number {
  return value === 1 ? 9 : 7.1;
}

/** Stem points up when the chord's average pitch is below the staff's middle line. */
export function stemUpForChord(diatonics: number[], staff: Staff): boolean {
  const middle = staff === 'treble' ? TREBLE_MIDDLE : BASS_MIDDLE;
  const avg = diatonics.reduce((a, b) => a + b, 0) / diatonics.length;
  return avg < middle;
}

/**
 * Horizontal offset (px) for each notehead of a chord so that notes a second
 * apart sit on opposite sides of the stem. Input diatonics must be sorted
 * ascending; output is in the same order. For a single second the lower note is
 * kept on the left and the upper note is pushed to the right (regardless of stem
 * direction); runs of consecutive seconds alternate from there.
 */
export function secondOffsets(diatonicsAsc: number[], stemUp: boolean, headHW: number): number[] {
  const n = diatonicsAsc.length;
  const displaced = new Array<boolean>(n).fill(false);
  if (stemUp) {
    // keep the lower note on the (normal) left, push the upper note of a second right
    for (let i = 1; i < n; i++) {
      if (diatonicsAsc[i] - diatonicsAsc[i - 1] === 1 && !displaced[i - 1]) displaced[i] = true;
    }
  } else {
    // keep the upper note on the (normal) right, push the lower note of a second left
    for (let i = n - 2; i >= 0; i--) {
      if (diatonicsAsc[i + 1] - diatonicsAsc[i] === 1 && !displaced[i + 1]) displaced[i] = true;
    }
  }
  const disp = 2 * (headHW - STEM_INSET);
  return displaced.map((d) => (d ? (stemUp ? disp : -disp) : 0));
}

/** Diatonic positions of the ledger lines needed to reach pitch `d`. */
export function ledgerLineDiatonics(d: number): number[] {
  const lines: number[] = [];
  if (d >= 40) for (let q = 40; q <= d; q += 2) lines.push(q); // above the treble staff
  if (d <= 16) for (let q = 16; q >= d; q -= 2) lines.push(q); // below the bass staff
  if (d === 28) lines.push(28); // middle C, between the staves
  return lines;
}

// ---- Horizontal mapping ----
export function measureContentWidth(ts: TimeSignature): number {
  return Math.max(150, measureTicks(ts) * PX_PER_TICK + 2 * MEASURE_PAD);
}

export function tickToX(leftX: number, contentW: number, tick: number, total: number): number {
  const usable = contentW - 2 * MEASURE_PAD;
  return leftX + MEASURE_PAD + (tick / total) * usable;
}
export function xToTickRaw(leftX: number, contentW: number, x: number, total: number): number {
  const usable = contentW - 2 * MEASURE_PAD;
  return ((x - leftX - MEASURE_PAD) / usable) * total;
}

// ---- System layout ----
export type LayoutMode = 'horizontal' | 'page';

export interface PlacedMeasure {
  measure: Measure;
  index: number; // global measure index
  leftX: number; // x of the measure's left edge
  contentW: number;
}
export interface SystemLayout {
  measures: PlacedMeasure[];
  width: number; // total svg width of the system
}

export function layoutSystems(
  measures: Measure[],
  ts: TimeSignature,
  mode: LayoutMode,
  availableWidth: number,
  header: number = HEADER_WIDTH,
): SystemLayout[] {
  const cw = measureContentWidth(ts);

  if (mode === 'horizontal') {
    const placed = measures.map((m, i) => ({
      measure: m,
      index: i,
      leftX: header + i * cw,
      contentW: cw,
    }));
    return [{ measures: placed, width: header + measures.length * cw + 2 }];
  }

  // page mode: wrap measures into systems by available width
  const usable = Math.max(cw, availableWidth - header - 6);
  const perSystem = Math.max(1, Math.floor(usable / cw));
  const systems: SystemLayout[] = [];
  for (let i = 0; i < measures.length; i += perSystem) {
    const slice = measures.slice(i, i + perSystem);
    const placed = slice.map((m, j) => ({
      measure: m,
      index: i + j,
      leftX: header + j * cw,
      contentW: cw,
    }));
    systems.push({ measures: placed, width: header + slice.length * cw + 2 });
  }
  if (systems.length === 0) systems.push({ measures: [], width: header + cw });
  return systems;
}

// key-signature layout
export const KEYSIG_X = 46; // x of the first key-signature accidental
export const KEYSIG_STEP = 10; // horizontal gap between accidentals
export function keySigWidth(keySig: number): number {
  return Math.abs(keySig) * KEYSIG_STEP;
}
export function headerWidthFor(keySig: number): number {
  return HEADER_WIDTH + keySigWidth(keySig);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
