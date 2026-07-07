// The score's staff list and the vertical layout of a system.
//
// A score is a top-to-bottom list of staves; staves sharing a `group` form a
// grand staff ("endecalineo": brace + one continuous vertical axis, so notes
// and interactions flow across the pair exactly like the classic layout).
// Rendering happens per ROW (a single staff or a grand pair): each row keeps
// the app's original linear axis `diatonicToY` and is shifted into place with
// an SVG translate, so one grand row reproduces the historical layout 1:1.
import { Clef, ScoreState, Staff, StaffDef } from './types';
import { diatonicToY } from './layout';
import { STAFF_TOP, SYSTEM_HEIGHT } from './constants';

export interface ClefInfo {
  lines: number[]; // staff lines as diatonic positions, top -> bottom
  middle: number; // middle line (stem direction, rest baseline)
  glyphD: number; // diatonic the clef glyph anchors on
  keysigOffset: number; // diatonic shift of the key-signature pattern (0 = treble position)
  timeD: [number, number]; // numerator / denominator anchor diatonics
}

export const CLEFS: Record<Clef, ClefInfo> = {
  treble: { lines: [38, 36, 34, 32, 30], middle: 34, glyphD: 32, keysigOffset: 0, timeD: [36, 32] },
  bass: { lines: [26, 24, 22, 20, 18], middle: 22, glyphD: 24, keysigOffset: -14, timeD: [24, 20] },
};

export const clefOf = (staves: StaffDef[], id: Staff): Clef => staves.find((s) => s.id === id)?.clef ?? (id === 'bass' ? 'bass' : 'treble');
export const middleOf = (staves: StaffDef[], id: Staff): number => CLEFS[clefOf(staves, id)].middle;

/** The classic grand staff (used when a score carries no staff list). */
export function defaultStaves(): StaffDef[] {
  return [
    { id: 'treble', clef: 'treble', key: null, group: 'grand' },
    { id: 'bass', clef: 'bass', key: null, group: 'grand' },
  ];
}

/** The score's staves, normalized (never empty). */
export function scoreStaves(score: Pick<ScoreState, 'staves'>): StaffDef[] {
  return score.staves && score.staves.length > 0 ? score.staves : defaultStaves();
}

/** Tolerant reader for a loaded file's staff list. */
export function sanitizeStaves(raw: unknown): StaffDef[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: StaffDef[] = [];
  const used = new Set<string>();
  for (const r of raw as Partial<StaffDef>[]) {
    if (!r || typeof r !== 'object') return null;
    const id = typeof r.id === 'string' && r.id ? r.id : null;
    if (!id || used.has(id)) return null;
    used.add(id);
    out.push({
      id,
      clef: r.clef === 'bass' ? 'bass' : 'treble',
      key: typeof r.key === 'number' && Number.isFinite(r.key) ? Math.max(-7, Math.min(7, Math.round(r.key))) : null,
      ...(r.hidden ? { hidden: true } : {}),
      ...(typeof r.group === 'string' && r.group ? { group: r.group } : {}),
      ...(typeof r.name === 'string' && r.name ? { name: r.name } : {}),
    });
  }
  return out;
}

/** A fresh staff id not yet used by the score. */
export function newStaffId(staves: StaffDef[]): string {
  let n = staves.length + 1;
  while (staves.some((s) => s.id === `s${n}`)) n++;
  return `s${n}`;
}

/** A fresh group id for a new grand staff. */
export function newGroupId(staves: StaffDef[]): string {
  let n = 2;
  while (staves.some((s) => s.group === `g${n}`)) n++;
  return `g${n}`;
}

/** Label shown in the mixer for one staff. */
export function staffLabel(staves: StaffDef[], def: StaffDef): string {
  if (def.name) return def.name;
  if (def.id === 'treble') return 'Rigo di violino';
  if (def.id === 'bass') return 'Rigo di basso';
  const idx = staves.findIndex((s) => s.id === def.id);
  if (def.group) {
    const mates = staves.filter((s) => s.group === def.group);
    const pos = mates.findIndex((s) => s.id === def.id);
    return `Endecalineo · ${pos === 0 ? 'violino' : 'basso'} (${def.id})`;
  }
  return `Pentagramma ${idx + 1} (${def.clef === 'bass' ? 'basso' : 'violino'})`;
}

// ---- Vertical layout ----

export interface StaffSlot {
  def: StaffDef;
  clef: ClefInfo;
  key: number | null; // per-staff key override (null = score key)
}

/** A rendering row: one staff, or the two staves of a grand group. */
export interface RowSlot {
  staves: StaffSlot[];
  grand: boolean; // both staves of a group are visible: draw the brace
  dy: number; // SVG translate applied to the row (row axis = classic axis + dy)
  topD: number; // first staff's top line (diatonic)
  botD: number; // last staff's bottom line (diatonic)
  topY: number; // absolute y of the top line
  botY: number; // absolute y of the bottom line
  bandTop: number; // absolute hit-test band
  bandBottom: number;
}

export interface StavesLayout {
  rows: RowSlot[];
  height: number; // svg height of one system
  topY: number; // absolute y of the first row's top line
  botY: number; // absolute y of the last row's bottom line
}

const MARGIN_TOP_FIRST = STAFF_TOP; // 64: room for the repeat count, ties, high ledgers
const MARGIN_TOP_NEXT = 46; // gap above every following row
const MARGIN_BOTTOM = SYSTEM_HEIGHT - STAFF_TOP - (diatonicToY(18) - diatonicToY(38)); // 88: chords + low ledgers

/**
 * Stacks the visible staves into rows. With the default staves this returns a
 * single grand row whose geometry (and total height) matches the historical
 * constants exactly.
 */
export function layoutStaves(defs: StaffDef[]): StavesLayout {
  let visible = defs.filter((s) => !s.hidden);
  if (visible.length === 0) visible = defs.slice(0, 1); // never render an empty system
  // consecutive staves of the same group form one row
  const rows: StaffSlot[][] = [];
  for (const def of visible) {
    const slot: StaffSlot = { def, clef: CLEFS[def.clef], key: def.key };
    const prev = rows[rows.length - 1];
    if (prev && def.group && prev[0].def.group === def.group && prev.length < 2) prev.push(slot);
    else rows.push([slot]);
  }
  const out: RowSlot[] = [];
  let y = 0;
  for (let i = 0; i < rows.length; i++) {
    const staves = rows[i];
    const topD = staves[0].clef.lines[0];
    const lastLines = staves[staves.length - 1].clef.lines;
    const botD = lastLines[lastLines.length - 1];
    const marginTop = i === 0 ? MARGIN_TOP_FIRST : MARGIN_TOP_NEXT;
    const topY = y + marginTop;
    const dy = topY - diatonicToY(topD);
    const botY = dy + diatonicToY(botD);
    out.push({ staves, grand: staves.length === 2, dy, topD, botD, topY, botY, bandTop: 0, bandBottom: 0 });
    y = botY;
  }
  const height = y + MARGIN_BOTTOM;
  // hit-test bands: midway between adjacent rows
  for (let i = 0; i < out.length; i++) {
    out[i].bandTop = i === 0 ? 0 : (out[i - 1].botY + out[i].topY) / 2;
    out[i].bandBottom = i === out.length - 1 ? height : (out[i].botY + out[i + 1].topY) / 2;
  }
  return { rows: out, height, topY: out[0].topY, botY: out[out.length - 1].botY };
}

/** The row containing an absolute y (never null: clamped to the nearest). */
export function rowAtY(layout: StavesLayout, y: number): RowSlot {
  return layout.rows.find((r) => y >= r.bandTop && y < r.bandBottom) ?? layout.rows[layout.rows.length - 1];
}

/** Staff id a diatonic position belongs to within a row (grand rows split at middle C). */
export function rowStaffForDiatonic(row: RowSlot, d: number): Staff {
  if (row.staves.length === 2) return d >= 28 ? row.staves[0].def.id : row.staves[1].def.id;
  return row.staves[0].def.id;
}

/** The row that renders a given staff id (null when the staff is hidden). */
export function rowOfStaff(layout: StavesLayout, id: Staff): RowSlot | null {
  return layout.rows.find((r) => r.staves.some((s) => s.def.id === id)) ?? null;
}

/** Sensible diatonic clamp for placements in a row (a few ledger lines out). */
export function rowClampD(row: RowSlot): [number, number] {
  return [row.botD - 13, row.topD + 12];
}

/**
 * Ledger lines needed for a note at diatonic `d` in a row: lines above the
 * top staff, below the bottom one, and — in a grand row — middle C's own line.
 */
export function rowLedgerLines(row: RowSlot, d: number): number[] {
  const lines: number[] = [];
  for (let q = row.topD + 2; q <= d; q += 2) lines.push(q);
  for (let q = row.botD - 2; q >= d; q -= 2) lines.push(q);
  if (row.staves.length === 2 && d === 28) lines.push(28);
  return lines;
}

/** Per-staff key resolution: the staff's own key, else the measure's effective key. */
export function staffKeyAt(slot: StaffSlot, measureKey: number): number {
  return slot.key ?? measureKey;
}
