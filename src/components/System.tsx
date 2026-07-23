import { Fragment, useRef, useState } from 'react';
import { Alter, Clef, Duration, NoteEvent, Pitch, ScoreEvent, Staff, TimeSignature } from '../music/types';
import { diatonicToPitch, durationTicks, eventTicks, pitchNameIt, pitchToDiatonic } from '../music/theory';
import {
  SystemLayout,
  PlacedMeasure,
  diatonicToY,
  yToDiatonic,
  measureTickToX,
  measureXToTickRaw,
  clamp,
  noteheadHalfWidth,
  stemUpForChord,
  secondOffsets,
  STEM_INSET,
  KEYSIG_X,
  KEYSIG_STEP,
  keySigWidth,
  REPEAT_START_PAD,
} from '../music/layout';
import { StavesLayout, RowSlot, rowAtY, rowClampD, rowLedgerLines, rowStaffForDiatonic, CLEFS } from '../music/staves';
import { drumVoice, drumVoiceNearest } from '../music/drums';
import { classifyNote, classifyRest, PlaceAction } from '../music/placement';
import { measureRests } from '../music/rests';
import { beamGroups, beamCount } from '../music/beams';
import { TieConn } from '../music/ties';
import { keyAlterForStep, keySignatureAccidentals, keyChangeNaturals } from '../music/key';
import { effectiveAlterForNew, resolveMeasure } from '../music/accidentals';
import { SMUFL, timeSigString } from '../music/smufl';
import {
  STAFF_LEFT,
  BRACE_X,
  CLEF_X,
  TIME_SIG_X,
  STAFF_LINE_WIDTH,
  BAR_LINE_WIDTH,
  GLYPH_FONT_SIZE,
  NOTEHEAD_RX,
  NOTEHEAD_RY,
  STEM_LENGTH,
  STAFF_SPACE,
  TICKS_PER_QUARTER,
} from '../music/constants';
import type { ScoreAction } from '../state/scoreReducer';
import { Tool } from '../state/tool';
import { Selection } from '../state/selection';
import { NoteView } from './Note';
import { RestView } from './Rest';

const CHORD_GRID = Math.round(TICKS_PER_QUARTER / 2); // chords snap to eighths
const SEL_FILL = 'rgba(37,99,235,0.13)';
const SEL_STROKE = 'rgba(37,99,235,0.7)';
const BEAM_THICK = 5;
const BEAM_GAP = 3.5;
const BEAM_MAX_SLOPE = 0.25; // px per px
const BEAM_MAX_RISE = 2.5 * STAFF_SPACE; // total rise across a group
const BEAM_MIN_CLEAR = 2.3 * STAFF_SPACE; // shortest stem from the outer notehead to the beam

/** Per-row rendering context: which staves it holds and their stem middles. */
interface RowCtx {
  staffIds: Staff[];
  middleOf: (staff: Staff) => number;
  topYAxis: number; // diatonicToY(row.topD) — row content bounds in axis coords
  botYAxis: number;
}

/**
 * Beams for the staves of one row in one measure: the stem-end y for each
 * beamed note plus the beam polygons. Beams are horizontal by default; when
 * `diagonal` is set they slope to follow the outer pitches (clamped, and kept
 * clear of the noteheads).
 */
function computeMeasureBeams(pm: PlacedMeasure, diagonal: boolean, ctx: RowCtx): { beamProps: Map<string, { stemUp: boolean; tipY: number }>; elements: JSX.Element[] } {
  const beamProps = new Map<string, { stemUp: boolean; tipY: number }>();
  const elements: JSX.Element[] = [];
  for (const staff of ctx.staffIds) {
    for (const group of beamGroups(pm.measure.events, staff, pm.ts)) {
      const allDs = group.flatMap((ev) => ev.pitches.map(pitchToDiatonic));
      const stemUp = stemUpForChord(allDs, ctx.middleOf(staff));
      const dir = stemUp ? 1 : -1; // +1 = beam above the noteheads (smaller y)
      const items = group.map((ev) => {
        const x = measureTickToX(pm, ev.startTick);
        const headHW = noteheadHalfWidth(ev.duration.value);
        const ds = ev.pitches.map(pitchToDiatonic);
        const outerY = stemUp ? diatonicToY(Math.max(...ds)) : diatonicToY(Math.min(...ds));
        return {
          ev,
          stemX: stemUp ? x + headHW - STEM_INSET : x - headHW + STEM_INSET,
          outerY,
          tipBase: outerY - dir * STEM_LENGTH, // ideal beam y giving a standard-length stem
          count: beamCount(ev.duration.value),
        };
      });

      // beam line  y = m*x + b
      let m = 0;
      let b: number;
      if (diagonal && items.length >= 2) {
        const x0 = items[0].stemX;
        const xN = items[items.length - 1].stemX;
        const span = xN - x0 || 1;
        let rise = items[items.length - 1].tipBase - items[0].tipBase;
        rise = Math.max(-BEAM_MAX_RISE, Math.min(BEAM_MAX_RISE, rise));
        m = Math.max(-BEAM_MAX_SLOPE, Math.min(BEAM_MAX_SLOPE, rise / span));
        b = items[0].tipBase - m * x0;
        // keep the shortest stem from clipping into the noteheads
        let worst = Infinity;
        for (const it of items) worst = Math.min(worst, dir * (it.outerY - (m * it.stemX + b)));
        if (worst < BEAM_MIN_CLEAR) b -= dir * (BEAM_MIN_CLEAR - worst);
      } else {
        b = stemUp ? Math.min(...items.map((it) => it.tipBase)) : Math.max(...items.map((it) => it.tipBase));
      }
      const lineY = (x: number) => m * x + b;
      for (const it of items) beamProps.set(it.ev.id, { stemUp, tipY: lineY(it.stemX) });

      const k = (s: string) => `bm-${pm.index}-${staff}-${group[0].id}-${s}`;
      const poly = (xa: number, xb: number, off: number) => {
        const ya = lineY(xa) + off;
        const yb = lineY(xb) + off;
        return `${xa},${ya - BEAM_THICK / 2} ${xb},${yb - BEAM_THICK / 2} ${xb},${yb + BEAM_THICK / 2} ${xa},${ya + BEAM_THICK / 2}`;
      };
      // primary beam
      elements.push(<polygon key={k('1')} points={poly(items[0].stemX, items[items.length - 1].stemX, 0)} fill="#1a1a1a" />);
      // secondary beams / beamlets (16th, 32nd)
      const maxLevel = Math.max(...items.map((it) => it.count));
      for (let L = 2; L <= maxLevel; L++) {
        const off = dir * (L - 1) * (BEAM_THICK + BEAM_GAP);
        let i = 0;
        while (i < items.length) {
          if (items[i].count < L) {
            i++;
            continue;
          }
          let end = i;
          while (end + 1 < items.length && items[end + 1].count >= L) end++;
          if (end > i) {
            elements.push(<polygon key={k(`${L}-${i}`)} points={poly(items[i].stemX, items[end].stemX, off)} fill="#1a1a1a" />);
          } else {
            const a = items[i].stemX;
            const stub = i > 0 ? a - 8 : a + 8; // beamlet stub toward the neighbour
            elements.push(<polygon key={k(`${L}-${i}b`)} points={poly(Math.min(a, stub), Math.max(a, stub), off)} fill="#1a1a1a" />);
          }
          i = end + 1;
        }
      }
    }
  }
  return { beamProps, elements };
}

/**
 * Extra horizontal offset for a rest so an up-stem flag on the preceding note
 * (which reaches to the right) doesn't overlap it. Only kicks in when the slot
 * is tight (tuplets); clamped so the rest never collides with the next event.
 */
function restClearShift(pm: PlacedMeasure, staff: Staff, startTick: number, beamProps: Map<string, { stemUp: boolean; tipY: number }>, middle: number): number {
  let prev: ScoreEvent | null = null;
  let next: ScoreEvent | null = null;
  for (const e of pm.measure.events) {
    if (e.staff !== staff) continue;
    if (e.startTick < startTick && (!prev || e.startTick > prev.startTick)) prev = e;
    if (e.startTick > startTick && (!next || e.startTick < next.startTick)) next = e;
  }
  if (!prev || prev.kind !== 'note') return 0;
  const flagged = beamCount(prev.duration.value) >= 1 && !beamProps.has(prev.id); // unbeamed -> has a flag
  if (!flagged) return 0;
  if (!stemUpForChord(prev.pitches.map(pitchToDiatonic), middle)) return 0; // down-stem flags stay left of the notehead
  const slotX = measureTickToX(pm, startTick);
  const flagRight = measureTickToX(pm, prev.startTick) + 1.9 * STAFF_SPACE; // notehead + stem + flag reach
  let shift = Math.max(0, flagRight + 0.45 * STAFF_SPACE - slotX);
  if (next) {
    const nextLeft = measureTickToX(pm, next.startTick) - (next.kind === 'note' ? noteheadHalfWidth(next.duration.value) : 0.45 * STAFF_SPACE);
    shift = Math.max(0, Math.min(slotX + shift, nextLeft - 0.45 * STAFF_SPACE - 2) - slotX);
  }
  return shift;
}

/**
 * Tuplet brackets / numbers for one row of one measure. A beamed tuplet (e.g.
 * eighth-note triplets) shows just the number over the beam; an unbeamed one
 * (quarter triplets) gets a bracket with the number, clear of the stems.
 */
function renderMeasureTuplets(pm: PlacedMeasure, beamProps: Map<string, { stemUp: boolean; tipY: number }>, ctx: RowCtx): JSX.Element[] {
  const els: JSX.Element[] = [];
  const groups = new Map<string, ScoreEvent[]>();
  for (const ev of pm.measure.events) {
    if (!ev.tuplet || !ctx.staffIds.includes(ev.staff)) continue;
    const arr = groups.get(ev.tuplet.id) ?? [];
    arr.push(ev);
    groups.set(ev.tuplet.id, arr);
  }
  for (const [tid, raw] of groups) {
    const members = raw.slice().sort((a, b) => a.startTick - b.startTick);
    if (members.length === 0) continue;
    const staff = members[0].staff;
    const middle = ctx.middleOf(staff);
    const notes = members.filter((e): e is NoteEvent => e.kind === 'note');
    const allDs = notes.flatMap((e) => e.pitches.map(pitchToDiatonic));
    const stemUp = allDs.length ? stemUpForChord(allDs, middle) : true;
    const dir = stemUp ? 1 : -1; // +1 = above the noteheads (smaller y)
    const xs = members.map((e) => measureTickToX(pm, e.startTick));
    const x0 = xs[0] - noteheadHalfWidth(members[0].duration.value);
    const x1 = xs[xs.length - 1] + noteheadHalfWidth(members[members.length - 1].duration.value);
    const midX = (x0 + x1) / 2;
    const number = String(members[0].tuplet!.actual);
    const numEl = (y: number) => (
      <text key={`tp-${pm.index}-${tid}-n`} x={midX} y={y} textAnchor="middle" dominantBaseline="middle" fontStyle="italic" fontFamily="serif" fontSize={13} fontWeight={700} fill="#1a1a1a" pointerEvents="none">
        {number}
      </text>
    );
    // Only a clean all-note beam shows just the number; if any member is a rest
    // (or not beamed), draw a bracket spanning the whole tuplet.
    const beamed = members.length >= 2 && members.every((e) => e.kind === 'note' && beamProps.has(e.id));
    if (beamed) {
      const tipYs = notes.map((e) => beamProps.get(e.id)!.tipY);
      const beamY = tipYs.reduce((a, b) => a + b, 0) / tipYs.length;
      els.push(numEl(beamY - dir * 11));
    } else {
      const tips = notes.map((e) => {
        const ds = e.pitches.map(pitchToDiatonic);
        const headY = stemUp ? diatonicToY(Math.max(...ds)) : diatonicToY(Math.min(...ds));
        return headY - dir * STEM_LENGTH;
      });
      const bracketY = tips.length
        ? (stemUp ? Math.min(...tips) - 6 : Math.max(...tips) + 6)
        : (stemUp ? ctx.topYAxis - 14 : ctx.botYAxis + 14);
      const hookY = bracketY + dir * 5;
      const gap = 8;
      const stroke = '#1a1a1a';
      els.push(
        <g key={`tp-${pm.index}-${tid}`} pointerEvents="none">
          <line x1={x0} y1={hookY} x2={x0} y2={bracketY} stroke={stroke} strokeWidth={1.3} />
          <line x1={x0} y1={bracketY} x2={midX - gap} y2={bracketY} stroke={stroke} strokeWidth={1.3} />
          <line x1={midX + gap} y1={bracketY} x2={x1} y2={bracketY} stroke={stroke} strokeWidth={1.3} />
          <line x1={x1} y1={bracketY} x2={x1} y2={hookY} stroke={stroke} strokeWidth={1.3} />
          {numEl(bracketY)}
        </g>,
      );
    }
  }
  return els;
}

/** Ties of value for the staves of one row: a flat arc per tied pitch (split at the line edges when it wraps). */
function renderSystemTies(layout: SystemLayout, ties: TieConn[], ctx: RowCtx): JSX.Element[] {
  const els: JSX.Element[] = [];
  const leftEdge = layout.header + 4;
  const rightEdge = layout.width - 4;
  ties.forEach((t, i) => {
    if (!ctx.staffIds.includes(t.staff)) return;
    const pmFrom = layout.measures.find((p) => p.index === t.fromIndex);
    const pmTo = layout.measures.find((p) => p.index === t.toIndex);
    if (!pmFrom && !pmTo) return; // neither endpoint is on this line
    let y = diatonicToY(t.diatonic);
    const hx1 = pmFrom ? measureTickToX(pmFrom, t.fromTick) : leftEdge;
    const hx2 = pmTo ? measureTickToX(pmTo, t.toTick) : rightEdge;
    let x1 = pmFrom ? hx1 + NOTEHEAD_RX + 1.5 : leftEdge;
    let x2 = pmTo ? hx2 - NOTEHEAD_RX - 1.5 : rightEdge;
    const dir = t.diatonic >= ctx.middleOf(t.staff) ? -1 : 1; // higher notes: arc above; lower: below
    // notes so close that the gap between the heads vanishes (short values):
    // an arc in the gap would hide behind the noteheads, so draw it head-center
    // to head-center, shifted just past the heads (standard for tight ties)
    if (x2 - x1 < 8) {
      x1 = hx1 + 1;
      x2 = hx2 - 1;
      y += dir * 0.62 * STAFF_SPACE;
    }
    const cx = (x1 + x2) / 2;
    const bulge = Math.min(0.85 * STAFF_SPACE, 2.5 + (x2 - x1) * 0.3); // tiny ties get a shallower arc
    const d = `M ${x1} ${y} Q ${cx} ${y + dir * bulge} ${x2} ${y} Q ${cx} ${y + dir * (bulge - 2.4)} ${x1} ${y} Z`;
    els.push(<path key={`tie-${t.fromIndex}-${t.toIndex}-${t.diatonic}-${i}`} d={d} fill="#1a1a1a" pointerEvents="none" />);
  });
  return els;
}

/** Vertical wavy line (the arpeggio squiggle) at x from y0 down to y1. */
function wavyPath(x: number, y0: number, y1: number): string {
  const A = 3;
  const SEG = 6.5;
  let d = `M ${x} ${y0}`;
  let y = y0;
  let k = 0;
  while (y < y1 - 0.5) {
    const ny = Math.min(y + SEG, y1);
    d += ` Q ${x + (k % 2 ? -A : A)} ${(y + ny) / 2} ${x} ${ny}`;
    y = ny;
    k++;
  }
  return d;
}

const GHOST_COLOR: Record<PlaceAction, string> = {
  create: '#94a3b8',
  chord: '#2563eb',
  delete: '#dc2626',
  resize: '#0891b2',
  blocked: '#dc2626',
};
const GHOST_OPACITY: Record<PlaceAction, number> = {
  create: 0.6,
  chord: 0.65,
  delete: 0.65,
  resize: 0.7,
  blocked: 0.25,
};

interface PlaceHover {
  mode: 'place';
  measureIndex: number;
  tick: number;
  diatonic: number;
  alter: Alter; // effective alteration (key signature + accidentals so far in the measure)
  staff: Staff;
  drum?: string; // drum voice id when placing on a percussion staff
  action: PlaceAction;
}
interface TargetHover {
  mode: 'target';
  measureIndex: number;
  eventId: string;
  staff: Staff; // of the hit event (the accidental preview sounds with its instrument)
  diatonic: number | null;
  hx: number;
  hy: number;
}
interface RepeatHover {
  mode: 'repeat';
  measureIndex: number;
  edge: 'start' | 'end';
}
interface ChordHover {
  mode: 'chordsym';
  x: number; // snapped caret position
}
type Hover = PlaceHover | TargetHover | RepeatHover | ChordHover;

interface SystemProps {
  layout: SystemLayout;
  stavesLayout: StavesLayout;
  headerTs: TimeSignature;
  headerKeySig: number;
  showTimeSig: boolean;
  diagonalBeams: boolean;
  tool: Tool;
  duration: Duration;
  previewOnCreate: boolean;
  selection: Selection | null;
  playheadX: number | null;
  showHandle: boolean;
  playOnly?: boolean; // shared "listen" view: clicking only moves the playback cursor
  onAction: (action: ScoreAction) => void;
  onAfterApply: () => void;
  onPreviewNote: (pitches: Pitch[], staff?: Staff) => void;
  onSetCursor: (tick: number) => void;
  onHoverNote: (name: string | null) => void;
  drumVoiceId: string; // active drum voice for placement on a percussion staff
  ties: TieConn[];
}

export function System(props: SystemProps) {
  const {
    layout,
    stavesLayout: sl,
    headerTs,
    headerKeySig,
    showTimeSig,
    diagonalBeams,
    tool,
    duration,
    previewOnCreate,
    selection,
    playheadX,
    showHandle,
    playOnly = false,
    onAction,
    onAfterApply,
    onPreviewNote,
    onSetCursor,
    onHoverNote,
    drumVoiceId,
    ties,
  } = props;

  // ---- per-staff lookup tables over the visible rows ----
  const rowByStaff = new Map<Staff, RowSlot>();
  const keyOverride = new Map<Staff, number | null>();
  const clefByStaff = new Map<Staff, Clef>();
  for (const row of sl.rows) {
    for (const s of row.staves) {
      rowByStaff.set(s.def.id, row);
      keyOverride.set(s.def.id, s.key);
      clefByStaff.set(s.def.id, s.def.clef);
    }
  }
  const visibleStaffIds = sl.rows.flatMap((r) => r.staves.map((s) => s.def.id));
  const middleOf = (staff: Staff): number => CLEFS[clefByStaff.get(staff) ?? 'treble'].middle;
  const isPercStaff = (staff: Staff): boolean => clefByStaff.get(staff) === 'percussion';
  const dyOf = (staff: Staff): number => rowByStaff.get(staff)?.dy ?? 0;
  /** Key signature a staff reads in a measure: its own override, else the measure's (percussion has none). */
  const staffKey = (staff: Staff, measureKey: number): number => (isPercStaff(staff) ? 0 : keyOverride.get(staff) ?? measureKey);
  const rowCtx = (row: RowSlot): RowCtx => ({
    staffIds: row.staves.map((s) => s.def.id),
    middleOf,
    topYAxis: diatonicToY(row.topD),
    botYAxis: diatonicToY(row.botD),
  });

  // effective key signature of a given measure index in this system
  function keyAt(index: number): number {
    return layout.measures.find((p) => p.index === index)?.keySig ?? headerKeySig;
  }
  // pitch the note tool would create at a diatonic, honouring a key signature
  function keyedPitch(d: number, keySig: number): Pitch {
    const p = diatonicToPitch(d, 0);
    return { ...p, alter: keyAlterForStep(p.step, keySig) };
  }

  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [cursorDrag, setCursorDrag] = useState(false);
  const noteDragRef = useRef<{ measureIndex: number; eventId: string; staff: Staff; lastD: number; drum?: string; startY: number } | null>(null);
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const cursorDragRef = useRef(false); // a playhead-handle interaction is in progress
  // chord-name editing (the chord tool): an inline input under the staves
  const [chordEdit, setChordEdit] = useState<{ measureIndex: number; tick: number; x: number; value: string } | null>(null);
  // arpeggio tool: vertical drag over the notes to include in the roll
  const [arpDrag, setArpDrag] = useState<{ measureIndex: number; tick: number; x: number; staffIds: Staff[]; startY: number; curY: number } | null>(null);
  // vertical drag on a |: sign to set the play count
  const repeatDragRef = useRef<{ index: number; startTimes: number; startY: number; lastTimes: number } | null>(null);
  const [repeatDragIndex, setRepeatDragIndex] = useState<number | null>(null); // show the count (even ×1) while dragging
  const lastRepeatInsertRef = useRef<{ key: string; t: number } | null>(null); // so a double-click on empty space doesn't insert+delete
  const CURSOR_GRID = Math.max(1, Math.round(TICKS_PER_QUARTER / 4)); // snap cursor to 16th-notes

  // chord-name baseline: below the last row, pushed down by its lowest ledger note
  // (uniform across the line so the names sit on one row)
  const lastRow = sl.rows[sl.rows.length - 1];
  const lastRowStaves = new Set(lastRow.staves.map((s) => s.def.id));
  const lowestDiatonic = Math.min(
    lastRow.botD,
    ...layout.measures.flatMap((pm) =>
      pm.measure.events.flatMap((e) => (e.kind === 'note' && lastRowStaves.has(e.staff) ? e.pitches.map(pitchToDiatonic) : [])),
    ),
  );
  const chordY = lastRow.dy + Math.min(sl.height - lastRow.dy - 8, Math.max(diatonicToY(lastRow.botD) + 50, diatonicToY(lowestDiatonic) + 20));

  const placing = tool.kind === 'note' || tool.kind === 'rest';
  const modal = tool.kind === 'accidental' || tool.kind === 'eraser' || tool.kind === 'dot' || tool.kind === 'tuplet' || tool.kind === 'tie' || tool.kind === 'staccato';

  function localPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function measureAt(x: number) {
    return layout.measures.find((p) => x >= p.leftX && x < p.leftX + p.contentW) ?? null;
  }

  // global tick (across measures) for a local x, snapped to the cursor grid
  function globalTickAt(x: number): number | null {
    const pm = measureAt(x);
    if (!pm) return null;
    const raw = measureXToTickRaw(pm, x);
    const t = clamp(Math.round(raw / CURSOR_GRID) * CURSOR_GRID, 0, pm.total);
    return pm.startTick + t;
  }

  // ---- placement tools (note / rest): snap to a grid slot ----
  function computePlace(x: number, y: number): PlaceHover | null {
    const pm = measureAt(x);
    if (!pm) return null;

    const row = rowAtY(sl, y);
    const [dLo, dHi] = rowClampD(row);
    let d = clamp(yToDiatonic(y - row.dy), dLo, dHi);
    const staff = rowStaffForDiatonic(row, d);
    // on a percussion staff the note tool places the active drum voice at its
    // fixed staff position (the click only picks the tick)
    const perc = isPercStaff(staff) && tool.kind === 'note' ? drumVoice(drumVoiceId) : null;
    if (perc) d = perc.diatonic;
    const grid = durationTicks(duration);
    const pxPerTick = pm.noteSpan / Math.max(1, pm.spanTicks);
    // catch zone of an existing event: never wider than half a grid step, or
    // short durations couldn't reach the slot right next to a placed note
    const catchR = Math.max(4, Math.min(11, grid * pxPerTick * 0.45));

    let tick: number | null = null;
    for (const e of pm.measure.events) {
      const ex = measureTickToX(pm, e.startTick);
      if (Math.abs(ex - x) <= catchR) {
        tick = e.startTick;
        break;
      }
    }
    if (tick === null) {
      // candidate slots: the duration grid, plus the end of every same-staff
      // event — so any note can start right after an explicit rest (or note)
      // that sits off the current grid
      const maxStart = Math.max(0, pm.capacityTicks - grid);
      const raw = measureXToTickRaw(pm, x);
      const candidates = new Set<number>([clamp(Math.round(raw / grid) * grid, 0, maxStart)]);
      for (const e of pm.measure.events) {
        if (e.staff !== staff) continue;
        const end = e.startTick + eventTicks(e);
        if (end <= maxStart) candidates.add(end);
      }
      tick = [...candidates].reduce((best, c) =>
        Math.abs(measureTickToX(pm, c) - x) < Math.abs(measureTickToX(pm, best) - x) ? c : best,
      );
    }
    if (pm.pickup) {
      // pack the anacrusis from the start: appending never leaves a leading gap,
      // so the upbeat begins on its first note.
      const contentEnd = pm.measure.events.reduce((mx, e) => Math.max(mx, e.startTick + eventTicks(e)), 0);
      tick = Math.min(tick, contentEnd);
    }
    const base: Pitch = perc ? { ...diatonicToPitch(d, 0), drum: perc.id } : diatonicToPitch(d, 0);
    const alter = perc ? 0 : effectiveAlterForNew(pm.measure.events, staffKey(staff, pm.keySig), staff, base.step, base.octave, tick);
    const action =
      tool.kind === 'rest'
        ? classifyRest(pm.measure.events, tick, duration, pm.capacityTicks, staff)
        : classifyNote(pm.measure.events, tick, base, duration, pm.capacityTicks, staff);
    return { mode: 'place', measureIndex: pm.index, tick, diatonic: d, alter, staff, ...(perc ? { drum: perc.id } : {}), action };
  }

  // report the hovered ghost-note's name (key signature + measure accidentals) to the parent
  const lastHoverName = useRef<string | null>(null);
  function setHoverState(h: Hover | null) {
    setHover(h);
    const name =
      h?.mode === 'place' && tool.kind === 'note' && (h.action === 'create' || h.action === 'chord' || h.action === 'resize')
        ? h.drum
          ? drumVoice(h.drum)?.label ?? null
          : pitchNameIt({ ...diatonicToPitch(h.diatonic, 0), alter: h.alter })
        : null;
    if (name !== lastHoverName.current) {
      lastHoverName.current = name;
      onHoverNote(name);
    }
  }

  // nearest notehead to (x,y) across all rows; leftPad widens the catch zone to the left (for accidentals)
  function pickNotehead(x: number, y: number, leftPad: number) {
    let best: { measureIndex: number; eventId: string; staff: Staff; diatonic: number; drum?: string; hx: number; hy: number; dist: number } | null = null;
    for (const pm of layout.measures) {
      for (const ev of pm.measure.events) {
        if (ev.kind !== 'note' || !rowByStaff.has(ev.staff)) continue;
        const dy = dyOf(ev.staff);
        const ex = measureTickToX(pm, ev.startTick);
        const ds = ev.pitches.map(pitchToDiatonic);
        const offs = secondOffsets(ds, stemUpForChord(ds, middleOf(ev.staff)), noteheadHalfWidth(ev.duration.value));
        for (let pi = 0; pi < ds.length; pi++) {
          const d = ds[pi];
          const ey = dy + diatonicToY(d);
          const hx = ex + offs[pi];
          const dx = x - hx;
          const dyy = y - ey;
          const inX = dx <= NOTEHEAD_RX + 4 && dx >= -(NOTEHEAD_RX + 4 + leftPad);
          if (inX && Math.abs(dyy) <= NOTEHEAD_RY + 4) {
            const dist = Math.hypot(dx, dyy);
            if (!best || dist < best.dist) best = { measureIndex: pm.index, eventId: ev.id, staff: ev.staff, diatonic: d, drum: ev.pitches[pi].drum, hx, hy: ey, dist };
          }
        }
      }
    }
    return best;
  }

  // nearest EXPLICIT rest to (x,y) — for the eraser (auto-derived rests aren't events)
  function pickRest(x: number, y: number) {
    let best: { measureIndex: number; eventId: string; staff: Staff; hx: number; hy: number; dist: number } | null = null;
    for (const pm of layout.measures) {
      for (const ev of pm.measure.events) {
        if (ev.kind !== 'rest' || !rowByStaff.has(ev.staff)) continue;
        const hx = measureTickToX(pm, ev.startTick);
        const hy = dyOf(ev.staff) + diatonicToY(middleOf(ev.staff));
        const dx = x - hx;
        const dyy = y - hy;
        if (Math.abs(dx) <= 11 && Math.abs(dyy) <= 2 * STAFF_SPACE) {
          const dist = Math.hypot(dx, dyy);
          if (!best || dist < best.dist) best = { measureIndex: pm.index, eventId: ev.id, staff: ev.staff, hx, hy, dist };
        }
      }
    }
    return best;
  }

  // ---- chord tool: snapped position (or existing chord) a click would target ----
  function chordTarget(x: number): { pm: PlacedMeasure; tick: number; existing?: { tick: number; text: string } } | null {
    const pm = measureAt(x);
    if (!pm || pm.total <= 0) return null;
    // clicking near an existing chord name edits it
    const existing = (pm.measure.chords ?? []).find((c) => Math.abs(measureTickToX(pm, c.tick) - x) < 24);
    if (existing) return { pm, tick: existing.tick, existing };
    const maxTick = Math.floor(Math.max(0, pm.total - 1) / CHORD_GRID) * CHORD_GRID;
    const tick = clamp(Math.round(measureXToTickRaw(pm, x) / CHORD_GRID) * CHORD_GRID, 0, maxTick);
    const atTick = (pm.measure.chords ?? []).find((c) => c.tick === tick);
    return { pm, tick, ...(atTick ? { existing: atTick } : {}) };
  }

  function commitChordEdit(save: boolean) {
    const ce = chordEdit;
    if (!ce) return;
    setChordEdit(null);
    if (!save) return;
    onAction({ type: 'SET_CHORD', index: ce.measureIndex, tick: ce.tick, text: ce.value });
    onAfterApply(); // one-shot chord tool reverts to the note tool
  }

  // ---- arpeggio tool: the note column (measure + tick) nearest to x, within the row under y ----
  function arpColumnAt(x: number, y: number): { pm: PlacedMeasure; tick: number; x: number; staffIds: Staff[] } | null {
    const pm = measureAt(x);
    if (!pm) return null;
    const row = rowAtY(sl, y);
    const staffIds = row.staves.map((s) => s.def.id);
    let best: { tick: number; ex: number; dist: number } | null = null;
    for (const ev of pm.measure.events) {
      if (ev.kind !== 'note' || !staffIds.includes(ev.staff)) continue;
      const ex = measureTickToX(pm, ev.startTick);
      const dist = Math.abs(ex - x);
      if (dist <= 20 && (!best || dist < best.dist)) best = { tick: ev.startTick, ex, dist };
    }
    return best ? { pm, tick: best.tick, x: best.ex, staffIds } : null;
  }

  function applyArpDrag() {
    const ad = arpDrag;
    if (!ad) return;
    setArpDrag(null);
    const pm = layout.measures.find((p) => p.index === ad.measureIndex);
    if (!pm) return;
    const y0 = Math.min(ad.startY, ad.curY) - 10;
    const y1 = Math.max(ad.startY, ad.curY) + 10;
    // the roll includes every chord of the column (any staff of the row) with a notehead in the dragged span
    const targets = pm.measure.events.filter(
      (e): e is NoteEvent =>
        e.kind === 'note' && e.startTick === ad.tick && ad.staffIds.includes(e.staff) && e.pitches.some((p) => {
          const y = dyOf(e.staff) + diatonicToY(pitchToDiatonic(p));
          return y >= y0 && y <= y1;
        }),
    );
    if (targets.length === 0) return;
    const on = !targets.every((e) => e.arpeggio); // re-applying to a rolled chord removes the roll
    onAction({ type: 'SET_ARPEGGIO', measureIndex: ad.measureIndex, eventIds: targets.map((e) => e.id), on });
    onAfterApply();
  }

  // ---- repeat tool: which sign a click on empty measure space would insert ----
  function computeRepeatHover(x: number): RepeatHover | null {
    const pm = measureAt(x);
    if (!pm) return null;
    const edge = x < pm.leftX + pm.contentW / 2 ? 'start' : 'end';
    const exists = edge === 'start' ? !!pm.measure.repeatStart : !!pm.measure.repeatEnd;
    if (exists) return null; // the existing sign's own hit zone takes over (drag / double-click)
    return { mode: 'repeat', measureIndex: pm.index, edge };
  }

  // ---- modal tools (accidental / eraser): hit-test an existing notehead ----
  function computeTarget(x: number, y: number): TargetHover | null {
    const hit = pickNotehead(x, y, tool.kind === 'accidental' ? 20 : 0);
    if (hit) return { mode: 'target', measureIndex: hit.measureIndex, eventId: hit.eventId, staff: hit.staff, diatonic: hit.diatonic, hx: hit.hx, hy: hit.hy };
    // the eraser also removes an explicit rest (no notehead there)
    if (tool.kind === 'eraser') {
      const r = pickRest(x, y);
      if (r) return { mode: 'target', measureIndex: r.measureIndex, eventId: r.eventId, staff: r.staff, diatonic: null, hx: r.hx, hy: r.hy };
    }
    return null;
  }

  // mousedown on a notehead with the note tool starts a diatonic drag-to-move
  function handleMouseDown(e: React.MouseEvent) {
    suppressClickRef.current = false; // fresh press: clear any stale click suppression
    if (playOnly || e.altKey) return;
    if (tool.kind === 'arpeggio') {
      const pt = localPoint(e.clientX, e.clientY);
      if (!pt) return;
      const col = arpColumnAt(pt.x, pt.y);
      if (col) setArpDrag({ measureIndex: col.pm.index, tick: col.tick, x: col.x, staffIds: col.staffIds, startY: pt.y, curY: pt.y });
      return;
    }
    if (tool.kind !== 'note' && tool.kind !== 'pointer') return;
    const pt = localPoint(e.clientX, e.clientY);
    if (!pt) return;
    const hit = pickNotehead(pt.x, pt.y, 0);
    if (hit) {
      noteDragRef.current = { measureIndex: hit.measureIndex, eventId: hit.eventId, staff: hit.staff, lastD: hit.diatonic, drum: hit.drum, startY: pt.y };
      movedRef.current = false;
      setHoverState(null);
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    const pt = localPoint(e.clientX, e.clientY);
    if (!pt) return;
    if (cursorDrag) {
      const g = globalTickAt(pt.x);
      if (g !== null) onSetCursor(g);
      return;
    }
    if (playOnly) return; // no hover ghosts or drags in the listen-only view
    if (arpDrag) {
      setArpDrag({ ...arpDrag, curY: pt.y });
      return;
    }
    const rd = repeatDragRef.current;
    if (rd) {
      const steps = Math.round((rd.startY - e.clientY) / 16); // up = more plays; below 1 = 0 = ∞
      const t = Math.max(0, Math.min(99, rd.startTimes + steps));
      if (t !== rd.lastTimes) {
        onAction({ type: 'SET_REPEAT_TIMES', index: rd.index, times: t });
        rd.lastTimes = t;
        movedRef.current = true;
      }
      return;
    }
    const nd = noteDragRef.current;
    if (nd) {
      // a real drag starts after a few pixels: a wobbly click near a notehead
      // must stay a click (inserting the next note), not nudge this one
      if (!movedRef.current && Math.abs(pt.y - nd.startY) < 5) return;
      const row = rowByStaff.get(nd.staff);
      if (!row) return;
      const [dLo, dHi] = rowClampD(row);
      const d = clamp(yToDiatonic(pt.y - row.dy), dLo, dHi);
      if (isPercStaff(nd.staff)) {
        // a drum note never becomes a pitch: dragging retargets it to the
        // nearest drum voice instead
        const voice = drumVoiceNearest(d);
        if (voice.id !== nd.drum && nd.drum) {
          onAction({ type: 'SET_NOTE_DRUM', measureIndex: nd.measureIndex, eventId: nd.eventId, fromDrum: nd.drum, toDrum: voice.id });
          nd.drum = voice.id;
          nd.lastD = voice.diatonic;
          movedRef.current = true;
          if (previewOnCreate) onPreviewNote([{ ...diatonicToPitch(voice.diatonic, 0), drum: voice.id }], nd.staff);
        }
        return;
      }
      if (d !== nd.lastD) {
        onAction({ type: 'MOVE_NOTE', measureIndex: nd.measureIndex, eventId: nd.eventId, fromDiatonic: nd.lastD, toDiatonic: d });
        nd.lastD = d;
        movedRef.current = true;
        if (previewOnCreate) onPreviewNote([keyedPitch(d, staffKey(nd.staff, keyAt(nd.measureIndex)))], nd.staff);
      }
      return;
    }
    if (placing) setHoverState(computePlace(pt.x, pt.y));
    else if (modal || tool.kind === 'pointer') setHoverState(computeTarget(pt.x, pt.y));
    else if (tool.kind === 'repeat') setHoverState(computeRepeatHover(pt.x));
    else if (tool.kind === 'chord') {
      const t = chordTarget(pt.x);
      setHoverState(t ? { mode: 'chordsym', x: measureTickToX(t.pm, t.tick) } : null);
    } else setHoverState(null);
  }

  function handleMouseUp() {
    setCursorDrag(false);
    if (cursorDragRef.current) {
      cursorDragRef.current = false;
      suppressClickRef.current = true; // dragging/clicking the playhead handle must not place a note
    }
    if (arpDrag) {
      applyArpDrag();
      suppressClickRef.current = true;
    }
    if (repeatDragRef.current) {
      repeatDragRef.current = null;
      setRepeatDragIndex(null);
      if (movedRef.current) {
        suppressClickRef.current = true;
        onAction({ type: 'COMMIT' }); // close the count drag's coalesced undo step
        movedRef.current = false;
      }
    }
    if (noteDragRef.current) {
      noteDragRef.current = null;
      if (movedRef.current) {
        suppressClickRef.current = true; // a drag happened: don't treat it as a click
        onAction({ type: 'COMMIT' }); // close the drag's coalesced undo step
      }
    }
  }

  function handleMouseLeave() {
    setHoverState(null);
    setCursorDrag(false);
    setArpDrag(null);
    if (noteDragRef.current) {
      noteDragRef.current = null;
      movedRef.current = false;
    }
    if (repeatDragRef.current) {
      repeatDragRef.current = null;
      setRepeatDragIndex(null);
      movedRef.current = false;
    }
  }

  function handleClick(e: React.MouseEvent) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const pt = localPoint(e.clientX, e.clientY);
    if (!pt) return;
    if (playOnly) {
      // listen-only view: any click just repositions the playback cursor
      const g = globalTickAt(pt.x);
      if (g !== null) onSetCursor(g);
      return;
    }
    if (e.altKey) {
      // alt-click on a notehead (note tool) deletes it; on empty space it
      // moves the playback/insertion cursor instead.
      if (tool.kind === 'note') {
        const hit = pickNotehead(pt.x, pt.y, 0);
        if (hit) {
          onAction({ type: 'ERASE', measureIndex: hit.measureIndex, eventId: hit.eventId, diatonic: hit.diatonic });
          return;
        }
      }
      const g = globalTickAt(pt.x);
      if (g !== null) onSetCursor(g);
      return;
    }
    if (tool.kind === 'select-measures' || tool.kind === 'select-notes') return;

    if (tool.kind === 'pointer') {
      // the arrow never creates: over a notehead only the drag acts, anywhere
      // else the click repositions the playback/insertion cursor
      if (!pickNotehead(pt.x, pt.y, 0)) {
        const g = globalTickAt(pt.x);
        if (g !== null) onSetCursor(g);
      }
      return;
    }

    if (tool.kind === 'chord') {
      const t = chordTarget(pt.x);
      if (!t) return;
      setChordEdit({ measureIndex: t.pm.index, tick: t.tick, x: measureTickToX(t.pm, t.tick), value: t.existing?.text ?? '' });
      return;
    }

    if (tool.kind === 'repeat') {
      // clicks on an existing sign are captured by its hit zone; here we insert
      if (e.detail >= 2) return; // double-click only ever deletes (on the sign)
      const pm = measureAt(pt.x);
      if (!pm) return;
      const edge = pt.x < pm.leftX + pm.contentW / 2 ? 'start' : 'end';
      lastRepeatInsertRef.current = { key: `${pm.index}:${edge}`, t: performance.now() };
      onAction({ type: 'SET_REPEAT', index: pm.index, edge, on: true });
      return;
    }

    if (tool.kind === 'note' || tool.kind === 'rest') {
      const target = computePlace(pt.x, pt.y);
      if (!target || target.action === 'blocked') return;
      if (tool.kind === 'rest') {
        onAction({ type: 'CLICK_REST', measureIndex: target.measureIndex, tick: target.tick, duration, staff: target.staff });
      } else {
        // a drum note carries its voice; a pitched note follows the key
        // signature and any accidental already in effect in the measure
        const pitch: Pitch = target.drum ? { ...diatonicToPitch(target.diatonic, 0), drum: target.drum } : diatonicToPitch(target.diatonic, 0);
        onAction({ type: 'CLICK_NOTE', measureIndex: target.measureIndex, tick: target.tick, pitch, duration, staff: target.staff });
        if (previewOnCreate && (target.action === 'create' || target.action === 'chord' || target.action === 'resize'))
          onPreviewNote([{ ...pitch, alter: target.alter }], target.staff); // sound it with its effective alteration

      }
      return;
    }

    // accidental / eraser / dot
    const hit = computeTarget(pt.x, pt.y);
    if (!hit) return;
    if (tool.kind === 'accidental') {
      if (hit.diatonic === null) return;
      onAction({ type: 'SET_ACCIDENTAL', measureIndex: hit.measureIndex, eventId: hit.eventId, diatonic: hit.diatonic, alter: tool.alter });
      // sound the note with its new alteration, like creating a note does
      // (with the staff, so it uses that staff's instrument/volume/transpose)
      if (previewOnCreate) onPreviewNote([diatonicToPitch(hit.diatonic, tool.alter)], hit.staff);
    } else if (tool.kind === 'eraser') {
      onAction({ type: 'ERASE', measureIndex: hit.measureIndex, eventId: hit.eventId, diatonic: hit.diatonic });
    } else if (tool.kind === 'dot') {
      onAction({ type: 'SET_DOTS', measureIndex: hit.measureIndex, eventId: hit.eventId, dots: tool.dots });
    } else if (tool.kind === 'tuplet') {
      onAction({ type: 'MAKE_TUPLET', measureIndex: hit.measureIndex, eventId: hit.eventId });
    } else if (tool.kind === 'tie') {
      onAction({ type: 'TOGGLE_TIE', measureIndex: hit.measureIndex, eventId: hit.eventId });
    } else if (tool.kind === 'staccato') {
      onAction({ type: 'TOGGLE_STACCATO', measureIndex: hit.measureIndex, eventId: hit.eventId });
    }
    onAfterApply();
  }

  // ---- ghost / hover highlight ----
  let overlay: JSX.Element | null = null;
  if (hover?.mode === 'place') {
    const pm = layout.measures.find((p) => p.index === hover.measureIndex);
    const row = rowByStaff.get(hover.staff);
    if (pm && row) {
      const gx = measureTickToX(pm, hover.tick);
      const color = GHOST_COLOR[hover.action];
      const op = GHOST_OPACITY[hover.action];
      overlay = (
        <g transform={`translate(0 ${row.dy})`}>
          {tool.kind === 'rest' ? (
            <RestView duration={duration} x={gx} color={color} middle={middleOf(hover.staff)} opacity={op} />
          ) : (
            <NoteView
              pitches={[{ ...diatonicToPitch(hover.diatonic, 0), alter: hover.alter, ...(hover.drum ? { drum: hover.drum } : {}) }]}
              duration={duration}
              middle={middleOf(hover.staff)}
              ledgerOf={(d) => rowLedgerLines(row, d)}
              keySignature={staffKey(hover.staff, pm.keySig)}
              x={gx}
              color={color}
              opacity={op}
            />
          )}
        </g>
      );
    }
  } else if (hover?.mode === 'repeat') {
    const pm = layout.measures.find((p) => p.index === hover.measureIndex);
    if (pm)
      overlay = (
        <g>
          {sl.rows.map((row, ri) => (
            <g key={ri} transform={`translate(0 ${row.dy})`}>
              {repeatSignEls(pm, row, hover.edge, '#2563eb', 0.45, 'rpthover')}
            </g>
          ))}
        </g>
      );
  } else if (hover?.mode === 'chordsym') {
    // text caret at the snapped eighth position
    overlay = (
      <g pointerEvents="none" stroke="#2563eb" opacity={0.8}>
        <line x1={hover.x} x2={hover.x} y1={chordY - 12} y2={chordY + 3} strokeWidth={1.6} />
        <line x1={hover.x - 4.5} x2={hover.x + 4.5} y1={chordY + 3} y2={chordY + 3} strokeWidth={1.3} />
      </g>
    );
  } else if (hover?.mode === 'target') {
    const color =
      tool.kind === 'accidental' ? '#2563eb' : tool.kind === 'dot' ? '#0891b2' : tool.kind === 'tuplet' ? '#7c3aed' : tool.kind === 'tie' ? '#0ea5e9' : tool.kind === 'staccato' ? '#d97706' : tool.kind === 'pointer' ? '#475569' : '#dc2626';
    overlay = (
      <g pointerEvents="none">
        <circle cx={hover.hx} cy={hover.hy} r={NOTEHEAD_RX + 3} fill={`${color}22`} stroke={color} strokeWidth={1.4} />
        {tool.kind === 'accidental' && (
          <text x={hover.hx - NOTEHEAD_RX - 3} y={hover.hy} textAnchor="end" fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill={color} opacity={0.85}>
            {SMUFL.accidentals[String(tool.alter)]}
          </text>
        )}
        {tool.kind === 'dot' && (
          <g fill={color}>
            {Array.from({ length: tool.dots }, (_, i) => (
              <circle key={i} cx={hover.hx + NOTEHEAD_RX + 5 + i * 5} cy={hover.hy} r={2.1} />
            ))}
          </g>
        )}
      </g>
    );
  }

  const selectedNoteIds = selection?.kind === 'notes' ? new Set(selection.ids) : null;
  const selectedMeasureIdx = selection?.kind === 'measures' ? new Set(selection.indices) : null;

  function noteHighlight(pm: PlacedMeasure, ev: Extract<ScoreEvent, { kind: 'note' }>) {
    const ex = measureTickToX(pm, ev.startTick);
    const ds = ev.pitches.map(pitchToDiatonic);
    const offs = secondOffsets(ds, stemUpForChord(ds, middleOf(ev.staff)), noteheadHalfWidth(ev.duration.value));
    const leftX = ex + Math.min(0, ...offs) - NOTEHEAD_RX - 4;
    const rightX = ex + Math.max(0, ...offs) + NOTEHEAD_RX + 4;
    const topY = diatonicToY(Math.max(...ds)) - NOTEHEAD_RY - 4;
    const botY = diatonicToY(Math.min(...ds)) + NOTEHEAD_RY + 4;
    return (
      <rect
        key={`sel-${ev.id}`}
        x={leftX}
        y={topY}
        width={rightX - leftX}
        height={botY - topY}
        rx={3}
        fill={SEL_FILL}
        stroke={SEL_STROKE}
        strokeWidth={1.2}
        pointerEvents="none"
      />
    );
  }

  // ---- repeat signs (|: / :|), drawn per row in its axis coordinates ----
  function repeatSignEls(pm: PlacedMeasure, row: RowSlot, edge: 'start' | 'end', color: string, opacity: number, keyPrefix: string) {
    const start = edge === 'start';
    // a |: hugs the barline; any mid-line key/time change is drawn after it
    const x = start ? pm.leftX + 2.5 : pm.leftX + pm.contentW - 2.5;
    const dir = start ? 1 : -1; // thin line + dots sit inside the measure
    const topY = diatonicToY(row.topD);
    const botY = diatonicToY(row.botD);
    const dotDs = row.staves.flatMap((s) => [s.clef.middle + 1, s.clef.middle - 1]);
    return (
      <g key={`${keyPrefix}-${pm.index}-${edge}`} opacity={opacity} pointerEvents="none">
        <line x1={x} x2={x} y1={topY} y2={botY} stroke={color} strokeWidth={3.4} />
        <line x1={x + dir * 5} x2={x + dir * 5} y1={topY} y2={botY} stroke={color} strokeWidth={1.2} />
        {dotDs.map((d) => (
          <circle key={d} cx={x + dir * 10} cy={diatonicToY(d)} r={2.3} fill={color} />
        ))}
      </g>
    );
  }

  // play count over the |: sign; ×1 stays hidden (unless being dragged), 0 shows as ∞ (endless loop)
  function repeatCountEl(pm: PlacedMeasure) {
    const times = pm.measure.repeatStart!.times;
    const dragging = repeatDragIndex === pm.index;
    if (times === 1 && !dragging) return null;
    return (
      <text
        key={`rptc-${pm.index}`}
        x={pm.leftX + 7.5}
        y={sl.topY - 16}
        textAnchor="middle"
        fontSize={times === 0 ? 17 : 13}
        fontWeight={700}
        fill={dragging ? '#7c3aed' : '#1a1a1a'}
        pointerEvents="none"
      >
        {times === 0 ? '∞' : `×${times}`}
      </text>
    );
  }

  // with the repeat tool active, each sign gets a hit zone: vertical drag on |:
  // changes the play count, double-click on either sign removes it
  function repeatHitZones(pm: PlacedMeasure) {
    if (tool.kind !== 'repeat') return null;
    const justInserted = (key: string) => {
      const ins = lastRepeatInsertRef.current;
      return !!ins && ins.key === key && performance.now() - ins.t < 500; // the insert double-click must not delete it right away
    };
    const consumeSuppress = () => {
      if (!suppressClickRef.current) return false;
      suppressClickRef.current = false;
      return true;
    };
    const zoneY = sl.topY - 32;
    const zoneH = sl.botY - sl.topY + 44;
    const zones: JSX.Element[] = [];
    if (pm.measure.repeatStart) {
      zones.push(
        <rect
          key={`rz-s-${pm.index}`}
          x={pm.leftX - 2}
          y={zoneY}
          width={19}
          height={zoneH}
          fill="transparent"
          style={{ cursor: 'ns-resize' }}
          onMouseDown={(e) => {
            e.stopPropagation();
            movedRef.current = false;
            const times = pm.measure.repeatStart!.times;
            repeatDragRef.current = { index: pm.index, startTimes: times, startY: e.clientY, lastTimes: times };
            setRepeatDragIndex(pm.index);
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (consumeSuppress()) return;
            if (e.detail >= 2 && !justInserted(`${pm.index}:start`)) onAction({ type: 'SET_REPEAT', index: pm.index, edge: 'start', on: false });
          }}
        />,
      );
    }
    if (pm.measure.repeatEnd) {
      zones.push(
        <rect
          key={`rz-e-${pm.index}`}
          x={pm.leftX + pm.contentW - 17}
          y={zoneY}
          width={19}
          height={zoneH}
          fill="transparent"
          style={{ cursor: 'pointer' }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (consumeSuppress()) return;
            if (e.detail >= 2 && !justInserted(`${pm.index}:end`)) onAction({ type: 'SET_REPEAT', index: pm.index, edge: 'end', on: false });
          }}
        />,
      );
    }
    return zones;
  }

  // rolled chords: one continuous squiggle per start tick, spanning every
  // flagged chord of the column within this row (its staves roll as one arpeggio)
  function renderArpeggios(pm: PlacedMeasure, ctx: RowCtx): JSX.Element[] {
    const groups = new Map<number, NoteEvent[]>();
    for (const ev of pm.measure.events) {
      if (ev.kind !== 'note' || !ev.arpeggio || !ctx.staffIds.includes(ev.staff)) continue;
      const list = groups.get(ev.startTick) ?? [];
      list.push(ev);
      groups.set(ev.startTick, list);
    }
    const els: JSX.Element[] = [];
    for (const [tick, evs] of groups) {
      const ds = evs.flatMap((e) => e.pitches.map(pitchToDiatonic));
      const yTop = diatonicToY(Math.max(...ds)) - 7;
      const yBot = diatonicToY(Math.min(...ds)) + 7;
      // clear of the widest notehead, displaced seconds and any explicit accidental
      let left = 0;
      let hasAcc = false;
      for (const e of evs) {
        const hw = noteheadHalfWidth(e.duration.value);
        const eds = e.pitches.map(pitchToDiatonic);
        const offs = secondOffsets(eds, stemUpForChord(eds, ctx.middleOf(e.staff)), hw);
        left = Math.max(left, hw - Math.min(0, ...offs));
        hasAcc = hasAcc || e.pitches.some((p) => p.explicit);
      }
      const x = measureTickToX(pm, tick) - left - (hasAcc ? 20 : 9);
      els.push(<path key={`arp-${pm.index}-${tick}`} d={wavyPath(x, yTop, yBot)} stroke="#1a1a1a" strokeWidth={1.7} fill="none" strokeLinecap="round" pointerEvents="none" />);
    }
    return els;
  }

  // staccato dots: on the notehead side, opposite the stem (which a beam may force)
  function renderStaccatos(pm: PlacedMeasure, beamProps: Map<string, { stemUp: boolean; tipY: number }>, ctx: RowCtx): JSX.Element[] {
    const els: JSX.Element[] = [];
    for (const ev of pm.measure.events) {
      if (ev.kind !== 'note' || !ev.staccato || !ctx.staffIds.includes(ev.staff)) continue;
      const ds = ev.pitches.map(pitchToDiatonic);
      const stemUp = beamProps.get(ev.id)?.stemUp ?? stemUpForChord(ds, ctx.middleOf(ev.staff));
      const y = stemUp ? diatonicToY(Math.min(...ds)) + 12 : diatonicToY(Math.max(...ds)) - 12;
      els.push(<circle key={`stc-${ev.id}`} cx={measureTickToX(pm, ev.startTick)} cy={y} r={2.2} fill="#1a1a1a" pointerEvents="none" />);
    }
    return els;
  }

  // mid-line key/time change for one row: double barline, cancellation naturals,
  // new key (only on staves following the score key) and new time digits
  // (drawn after the |: sign when the measure also starts a repeat)
  function renderChange(pm: PlacedMeasure, row: RowSlot) {
    const baseX = pm.leftX + 4 + (pm.measure.repeatStart ? REPEAT_START_PAD : 0);
    const naturalsCount = pm.keyChanged ? keyChangeNaturals(pm.prevKeySig, pm.keySig, 0).length : 0;
    const newCount = Math.abs(pm.keySig);
    const showKey = pm.keyChanged && row.staves.some((s) => s.key === null && s.def.clef !== 'percussion');
    const timeX = baseX + (showKey ? (naturalsCount + newCount) * KEYSIG_STEP + 12 : 16); // keep the digits clear of the barline
    return (
      <g pointerEvents="none">
        <line x1={pm.leftX - 3} x2={pm.leftX - 3} y1={diatonicToY(row.topD)} y2={diatonicToY(row.botD)} stroke="#222" strokeWidth={BAR_LINE_WIDTH} />
        {pm.keyChanged &&
          row.staves
            .filter((s) => s.key === null && s.def.clef !== 'percussion')
            .flatMap((s) => [
              ...keyChangeNaturals(pm.prevKeySig, pm.keySig, s.clef.keysigOffset).map((n, i) => (
                <text key={`nat${s.def.id}-${i}`} x={baseX + i * KEYSIG_STEP} y={diatonicToY(n.diatonic)} fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
                  {SMUFL.accidentals['0']}
                </text>
              )),
              ...keySignatureAccidentals(pm.keySig, s.clef.keysigOffset).map((a, j) => (
                <text key={`acc${s.def.id}-${j}`} x={baseX + (naturalsCount + j) * KEYSIG_STEP} y={diatonicToY(a.diatonic)} fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
                  {SMUFL.accidentals[String(a.alter)]}
                </text>
              )),
            ])}
        {pm.tsChanged &&
          row.staves.map((s, i) => (
            <Fragment key={`ts${i}`}>
              <text x={timeX} y={diatonicToY(s.clef.timeD[0])} textAnchor="middle" dominantBaseline="central" fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
                {timeSigString(pm.ts.numerator)}
              </text>
              <text x={timeX} y={diatonicToY(s.clef.timeD[1])} textAnchor="middle" dominantBaseline="central" fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
                {timeSigString(pm.ts.denominator)}
              </text>
            </Fragment>
          ))}
      </g>
    );
  }

  /** One row (single staff or grand pair) of one measure. */
  function renderRowMeasure(pm: PlacedMeasure, row: RowSlot, ctx: RowCtx) {
    // per-staff accidental resolution: transposing staves read their own key
    const resolved = resolveMeasure(pm.measure.events, (s) => staffKey(s, pm.keySig));
    const { beamProps, elements: beamEls } = computeMeasureBeams(pm, diagonalBeams, ctx);
    const events = pm.measure.events.filter((e) => ctx.staffIds.includes(e.staff));
    return (
      <Fragment key={pm.measure.id}>
        {(pm.keyChanged || pm.tsChanged) && renderChange(pm, row)}
        {beamEls}
        {renderMeasureTuplets(pm, beamProps, ctx)}
        {events.map((ev) =>
          ev.kind === 'note' ? (
            <NoteView
              key={ev.id}
              pitches={ev.pitches}
              duration={ev.duration}
              middle={ctx.middleOf(ev.staff)}
              ledgerOf={(d) => rowLedgerLines(row, d)}
              keySignature={staffKey(ev.staff, pm.keySig)}
              resolve={(step, octave) => resolved.get(`${ev.id}|${step}${octave}`)}
              x={measureTickToX(pm, ev.startTick)}
              color="#1a1a1a"
              beam={beamProps.get(ev.id)}
            />
          ) : (
            <RestView
              key={ev.id}
              duration={ev.duration}
              middle={ctx.middleOf(ev.staff)}
              x={measureTickToX(pm, ev.startTick) + restClearShift(pm, ev.staff, ev.startTick, beamProps, ctx.middleOf(ev.staff))}
              color="#1a1a1a"
            />
          ),
        )}
        {measureRests(pm.measure.events, pm.total, !pm.pickup, visibleStaffIds)
          .filter((r) => ctx.staffIds.includes(r.staff))
          .map((r, i) => (
            <RestView
              key={`rest-${i}`}
              duration={r.duration}
              middle={ctx.middleOf(r.staff)}
              x={r.whole ? measureTickToX(pm, pm.total / 2) : measureTickToX(pm, r.startTick) + restClearShift(pm, r.staff, r.startTick, beamProps, ctx.middleOf(r.staff))}
              color="#1a1a1a"
            />
          ))}
        {selectedNoteIds &&
          events
            .filter((ev): ev is Extract<ScoreEvent, { kind: 'note' }> => ev.kind === 'note' && selectedNoteIds.has(ev.id))
            .map((ev) => noteHighlight(pm, ev))}
        <line x1={pm.leftX + pm.contentW} x2={pm.leftX + pm.contentW} y1={ctx.topYAxis} y2={ctx.botYAxis} stroke="#222" strokeWidth={BAR_LINE_WIDTH} />
        {pm.measure.repeatStart && repeatSignEls(pm, row, 'start', '#1a1a1a', 1, 'rpt')}
        {pm.measure.repeatEnd && repeatSignEls(pm, row, 'end', '#1a1a1a', 1, 'rpt')}
        {renderArpeggios(pm, ctx)}
        {renderStaccatos(pm, beamProps, ctx)}
      </Fragment>
    );
  }

  /** Header (clef + key signature + optional time signature) of one row. */
  function renderRowHeader(row: RowSlot) {
    return (
      <g pointerEvents="none">
        {row.staves.map((s) => (
          <Fragment key={s.def.id}>
            <text x={CLEF_X} y={diatonicToY(s.clef.glyphD)} fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
              {s.def.clef === 'bass' ? SMUFL.fClef : s.def.clef === 'percussion' ? SMUFL.percussionClef : SMUFL.gClef}
            </text>
            {s.def.clef !== 'percussion' && keySignatureAccidentals(staffKey(s.def.id, headerKeySig), s.clef.keysigOffset).map((acc, i) => (
              <text key={`ks-${i}`} x={KEYSIG_X + i * KEYSIG_STEP} y={diatonicToY(acc.diatonic)} fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
                {SMUFL.accidentals[String(acc.alter)]}
              </text>
            ))}
            {showTimeSig && (
              <Fragment>
                <text x={TIME_SIG_X + keySigWidth(headerKeySig)} y={diatonicToY(s.clef.timeD[0])} textAnchor="middle" dominantBaseline="central" fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
                  {timeSigString(headerTs.numerator)}
                </text>
                <text x={TIME_SIG_X + keySigWidth(headerKeySig)} y={diatonicToY(s.clef.timeD[1])} textAnchor="middle" dominantBaseline="central" fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
                  {timeSigString(headerTs.denominator)}
                </text>
              </Fragment>
            )}
          </Fragment>
        ))}
      </g>
    );
  }

  return (
    <svg
      ref={svgRef}
      className="system"
      data-tool={playOnly ? 'play' : tool.kind}
      width={layout.width}
      height={sl.height}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {/* selected-measure highlights (behind everything, spanning every row) */}
      {selectedMeasureIdx &&
        layout.measures
          .filter((pm) => selectedMeasureIdx.has(pm.index))
          .map((pm) => (
            <rect
              key={`selm-${pm.index}`}
              x={pm.leftX}
              y={sl.topY - 10}
              width={pm.contentW}
              height={sl.botY - sl.topY + 20}
              fill={SEL_FILL}
              stroke={SEL_STROKE}
              strokeWidth={1.2}
              pointerEvents="none"
            />
          ))}

      {/* rows: staff lines, header and measure content, each in its own axis */}
      {sl.rows.map((row, ri) => {
        const ctx = rowCtx(row);
        return (
          <g key={ri} transform={`translate(0 ${row.dy})`}>
            {row.staves.flatMap((s) =>
              s.clef.lines.map((d) => {
                const y = diatonicToY(d);
                return <line key={`${s.def.id}-${d}`} x1={STAFF_LEFT} x2={layout.width} y1={y} y2={y} stroke="#222" strokeWidth={STAFF_LINE_WIDTH} />;
              }),
            )}
            {renderRowHeader(row)}
            {layout.measures.map((pm) => renderRowMeasure(pm, row, ctx))}
            {renderSystemTies(layout, ties, ctx)}
            {/* cautionary key change at the end of the line (next system starts in a new key) */}
            {layout.trailingKey &&
              (() => {
                const { fromKey, toKey } = layout.trailingKey;
                const contentRight = layout.measures.length ? Math.max(...layout.measures.map((m) => m.leftX + m.contentW)) : layout.header;
                const x0 = contentRight + 8;
                const natCount = keyChangeNaturals(fromKey, toKey, 0).length;
                return (
                  <g pointerEvents="none">
                    {row.staves
                      .filter((s) => s.key === null && s.def.clef !== 'percussion')
                      .flatMap((s) => [
                        ...keyChangeNaturals(fromKey, toKey, s.clef.keysigOffset).map((n, i) => (
                          <text key={`tnat${s.def.id}-${i}`} x={x0 + i * KEYSIG_STEP} y={diatonicToY(n.diatonic)} fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
                            {SMUFL.accidentals['0']}
                          </text>
                        )),
                        ...keySignatureAccidentals(toKey, s.clef.keysigOffset).map((a, j) => (
                          <text key={`tacc${s.def.id}-${j}`} x={x0 + (natCount + j) * KEYSIG_STEP} y={diatonicToY(a.diatonic)} fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
                            {SMUFL.accidentals[String(a.alter)]}
                          </text>
                        )),
                      ])}
                  </g>
                );
              })()}
          </g>
        );
      })}

      {/* braces (one per grand row) + the continuous line joining every staff */}
      {sl.rows
        .filter((r) => r.grand)
        .map((r, i) => {
          const mid = (r.topY + r.botY) / 2;
          const d = `M ${BRACE_X} ${r.topY} C ${BRACE_X - 7} ${r.topY + 20}, ${BRACE_X + 5} ${mid - 24}, ${BRACE_X - 3} ${mid} C ${BRACE_X + 5} ${mid + 24}, ${BRACE_X - 7} ${r.botY - 20}, ${BRACE_X} ${r.botY}`;
          return <path key={`brace-${i}`} d={d} stroke="#222" strokeWidth={2.4} fill="none" />;
        })}
      <line x1={STAFF_LEFT} x2={STAFF_LEFT} y1={sl.topY} y2={sl.botY} stroke="#222" strokeWidth={BAR_LINE_WIDTH} />

      {/* repeat counts + hit zones + chord names (system level, above/below the rows) */}
      {layout.measures.map((pm) => (
        <Fragment key={`sysm-${pm.measure.id}`}>
          {pm.measure.repeatStart && repeatCountEl(pm)}
          {repeatHitZones(pm)}
          {pm.measure.chords?.map((c) =>
            chordEdit && chordEdit.measureIndex === pm.index && chordEdit.tick === c.tick ? null : (
              <text
                key={`chs-${pm.index}-${c.tick}`}
                x={measureTickToX(pm, c.tick)}
                y={chordY}
                textAnchor="middle"
                fontSize={14}
                fontWeight={600}
                fontFamily="system-ui, sans-serif"
                fill="#1a1a1a"
                pointerEvents="none"
              >
                {c.text}
              </text>
            ),
          )}
        </Fragment>
      ))}

      {/* ghost / hover highlight */}
      {overlay}

      {/* live guide while dragging the arpeggio span */}
      {arpDrag && (
        <path
          d={wavyPath(arpDrag.x - 14, Math.min(arpDrag.startY, arpDrag.curY), Math.max(arpDrag.startY, arpDrag.curY) + 1)}
          stroke="#7c3aed"
          strokeWidth={2}
          fill="none"
          opacity={0.85}
          strokeLinecap="round"
          pointerEvents="none"
        />
      )}

      {/* playback / cursor bar (+ drag handle when not playing) */}
      {playheadX !== null && (
        <g>
          <g pointerEvents="none">
            <rect x={playheadX - 6} y={sl.topY - 10} width={12} height={sl.botY - sl.topY + 20} fill="rgba(56,132,255,0.16)" />
            <line x1={playheadX} x2={playheadX} y1={sl.topY - 16} y2={sl.botY + 10} stroke="rgba(56,132,255,0.9)" strokeWidth={1.5} />
          </g>
          {showHandle && (
            <path
              d={`M ${playheadX - 7} ${sl.topY - 22} L ${playheadX + 7} ${sl.topY - 22} L ${playheadX} ${sl.topY - 10} Z`}
              fill="rgba(56,132,255,0.95)"
              stroke="#fff"
              strokeWidth={0.6}
              style={{ cursor: 'ew-resize' }}
              onMouseDown={(e) => {
                e.stopPropagation();
                cursorDragRef.current = true;
                setCursorDrag(true);
              }}
            />
          )}
        </g>
      )}

      {/* inline editor for a chord name (chord tool) */}
      {chordEdit && (
        <foreignObject x={chordEdit.x - 48} y={chordY - 16} width={96} height={26}>
          <input
            className="chord-input"
            autoFocus
            value={chordEdit.value}
            placeholder="es. Cm7"
            onChange={(e) => setChordEdit({ ...chordEdit, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitChordEdit(true);
              else if (e.key === 'Escape') commitChordEdit(false);
            }}
            onBlur={() => commitChordEdit(true)}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          />
        </foreignObject>
      )}
    </svg>
  );
}
