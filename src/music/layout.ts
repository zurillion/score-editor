import { Measure, Staff, TimeSignature } from './types';
import { eventTicks, measureTicks } from './theory';
import { MeasureMeta } from './meta';
import { keyChangeNaturals } from './key';
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
  return widthForTicks(measureTicks(ts));
}
/** Drawn content width for a measure spanning `ticks` (a short anacrusis is narrower). */
export function widthForTicks(ticks: number): number {
  return Math.max(96, ticks * PX_PER_TICK + 2 * MEASURE_PAD);
}

const MIN_EVENT_PX = 16; // a note value should never be narrower than this

/**
 * Horizontal stretch for a crowded measure: the shortest event present must
 * get at least MIN_EVENT_PX, so a bar of 32nds (8px each at the base scale)
 * widens progressively instead of cramming.
 */
export function densityScale(m: Measure): number {
  let minTicks = Infinity;
  for (const e of m.events) minTicks = Math.min(minTicks, eventTicks(e));
  if (!Number.isFinite(minTicks) || minTicks <= 0) return 1;
  const px = minTicks * PX_PER_TICK;
  return px >= MIN_EVENT_PX ? 1 : Math.min(4, MIN_EVENT_PX / px);
}

/** Drawn width of a measure: a normal bar has a readable minimum; an anacrusis hugs its content. */
export function measureWidth(meta: MeasureMeta, scale = 1): number {
  if (meta.pickup) return Math.max(2 * MEASURE_PAD + 12, meta.spanTicks * scale * PX_PER_TICK + 2 * MEASURE_PAD);
  return widthForTicks(meta.spanTicks * scale);
}

/** x of a local tick inside a placed measure (notes start past any left inset). */
export function measureTickToX(pm: PlacedMeasure, tick: number): number {
  return pm.noteLeft + (tick / pm.spanTicks) * pm.noteSpan;
}
export function measureXToTickRaw(pm: PlacedMeasure, x: number): number {
  return ((x - pm.noteLeft) / pm.noteSpan) * pm.spanTicks;
}

// ---- System layout ----
export type LayoutMode = 'horizontal' | 'page';

export interface PlacedMeasure {
  measure: Measure;
  index: number; // global measure index
  leftX: number; // x of the measure's left edge (= previous measure's right edge)
  contentW: number; // full measure width, including any left inset
  total: number; // canonical ticks (rests, playhead clamp, where the next bar starts)
  spanTicks: number; // ticks the drawn width covers (= total, except an anacrusis adds editing room)
  capacityTicks: number; // max ticks that may be placed here
  pickup: boolean;
  keySig: number; // effective key signature
  ts: TimeSignature; // effective time signature
  startTick: number; // global cumulative start tick
  firstInSystem: boolean;
  leftInset: number; // px reserved at the left for a mid-line key/time change (0 otherwise)
  keyChanged: boolean; // draw a mid-line key change here
  tsChanged: boolean; // draw a mid-line time change here
  prevKeySig: number; // previous measure's key (for cancellation naturals)
  noteLeft: number; // x at tick 0
  noteSpan: number; // usable px for ticks
}
export interface SystemLayout {
  measures: PlacedMeasure[];
  width: number; // total svg width of the system
  header: number; // header width (brace + clefs + key signature)
  headerKeySig: number; // key signature shown in this system's header
  headerTs: TimeSignature; // time signature for the header
  headerTsChanged: boolean; // the first measure's time signature differs from the previous measure
  trailingKey?: { fromKey: number; toKey: number }; // cautionary key change at the end of the line
}

// key-signature layout
export const KEYSIG_X = 66; // x of the first key-signature accidental (clear of the clefs)
export const KEYSIG_STEP = 10; // horizontal gap between accidentals
export function keySigWidth(keySig: number): number {
  return Math.abs(keySig) * KEYSIG_STEP;
}
export function headerWidthFor(keySig: number): number {
  return HEADER_WIDTH + keySigWidth(keySig);
}

const CHANGE_PAD = 9; // padding around a mid-line key/time change

/** Width reserved at a measure's left for a mid-line key/time change. */
export function changeInsetWidth(meta: MeasureMeta): number {
  let w = 0;
  if (meta.keyChanged) {
    const naturals = keyChangeNaturals(meta.prevKeySig, meta.keySig, 0).length;
    w += (naturals + Math.abs(meta.keySig)) * KEYSIG_STEP + CHANGE_PAD;
  }
  if (meta.tsChanged) w += 34; // digits are drawn 16px past the barline, ~9px half-width each side
  return w > 0 ? w + CHANGE_PAD : 0;
}

// Extra measure width so repeat-sign dots stay clear of the notes.
export const REPEAT_START_PAD = 18;
export const REPEAT_END_PAD = 12;

/** Space reserved inside a measure for its repeat signs (0 without signs). */
export function repeatPads(m: Measure): { left: number; right: number } {
  return { left: m.repeatStart ? REPEAT_START_PAD : 0, right: m.repeatEnd ? REPEAT_END_PAD : 0 };
}

function buildSystem(
  measures: Measure[],
  metas: MeasureMeta[],
  from: number,
  to: number, // exclusive
): SystemLayout {
  const headerKeySig = metas[from].keySig;
  const header = headerWidthFor(headerKeySig);
  let x = header;
  const placed: PlacedMeasure[] = [];
  for (let i = from; i < to; i++) {
    const mm = metas[i];
    const firstInSystem = i === from;
    const leftInset = firstInSystem ? 0 : changeInsetWidth(mm); // line starts show the key in the header
    const pads = repeatPads(measures[i]);
    const contentW = measureWidth(mm, densityScale(measures[i])) + leftInset + pads.left + pads.right;
    const noteLeft = x + MEASURE_PAD + leftInset + pads.left;
    const noteSpan = contentW - 2 * MEASURE_PAD - leftInset - pads.left - pads.right;
    placed.push({
      measure: measures[i],
      index: i,
      leftX: x,
      contentW,
      total: mm.total,
      spanTicks: mm.spanTicks,
      capacityTicks: mm.capacityTicks,
      pickup: mm.pickup,
      keySig: mm.keySig,
      ts: mm.ts,
      startTick: mm.startTick,
      firstInSystem,
      leftInset,
      keyChanged: !firstInSystem && mm.keyChanged,
      tsChanged: !firstInSystem && mm.tsChanged,
      prevKeySig: mm.prevKeySig,
      noteLeft,
      noteSpan,
    });
    x += contentW;
  }
  return { measures: placed, width: x + 2, header, headerKeySig, headerTs: metas[from].ts, headerTsChanged: metas[from].tsChanged };
}

/** When a key change falls on a system break, show the cancellation+new key as a cautionary at the end of the previous line. */
function applyTrailingKey(systems: SystemLayout[], metas: MeasureMeta[]): void {
  for (let s = 0; s < systems.length - 1; s++) {
    const next = systems[s + 1].measures[0];
    if (!next) continue;
    const mm = metas[next.index];
    if (!mm.keyChanged) continue;
    systems[s].trailingKey = { fromKey: mm.prevKeySig, toKey: mm.keySig };
    const naturals = keyChangeNaturals(mm.prevKeySig, mm.keySig, 0).length;
    systems[s].width += (naturals + Math.abs(mm.keySig)) * KEYSIG_STEP + 16;
  }
}

export function layoutSystems(
  measures: Measure[],
  metas: MeasureMeta[],
  mode: LayoutMode,
  availableWidth: number,
): SystemLayout[] {
  if (measures.length === 0) {
    return [{ measures: [], width: HEADER_WIDTH + 150, header: HEADER_WIDTH, headerKeySig: 0, headerTs: { numerator: 4, denominator: 4 }, headerTsChanged: false }];
  }

  if (mode === 'horizontal') {
    return [buildSystem(measures, metas, 0, measures.length)];
  }

  // page mode: greedily pack measures into systems by their individual widths
  const systems: SystemLayout[] = [];
  let i = 0;
  while (i < measures.length) {
    const header = headerWidthFor(metas[i].keySig);
    const usable = Math.max(0, availableWidth - header - 6);
    let sum = 0;
    let j = i;
    while (j < measures.length) {
      const inset = j !== i && (metas[j].keyChanged || metas[j].tsChanged) ? changeInsetWidth(metas[j]) : 0;
      const pads = repeatPads(measures[j]);
      const w = measureWidth(metas[j], densityScale(measures[j])) + inset + pads.left + pads.right;
      if (j > i && sum + w > usable) break;
      sum += w;
      j++;
    }
    systems.push(buildSystem(measures, metas, i, j));
    i = j;
  }
  applyTrailingKey(systems, metas);
  return systems;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
