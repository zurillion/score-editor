import { Fragment, useRef, useState } from 'react';
import { Alter, Duration, NoteEvent, Pitch, ScoreEvent, Staff, TimeSignature } from '../music/types';
import { diatonicToPitch, durationTicks, eventTicks, pitchNameIt, pitchToDiatonic, staffForDiatonic } from '../music/theory';
import {
  SystemLayout,
  PlacedMeasure,
  diatonicToY,
  yToDiatonic,
  measureTickToX,
  measureXToTickRaw,
  clamp,
  TREBLE_LINES,
  BASS_LINES,
  TREBLE_MIDDLE,
  BASS_MIDDLE,
  noteheadHalfWidth,
  stemUpForChord,
  secondOffsets,
  STEM_INSET,
  KEYSIG_X,
  KEYSIG_STEP,
  keySigWidth,
} from '../music/layout';
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
  SYSTEM_HEIGHT,
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

const TOP_Y = diatonicToY(38);
const BOTTOM_Y = diatonicToY(18);
// repeat-sign dots sit in the spaces around the middle line of each staff
const REPEAT_DOT_DS = [TREBLE_MIDDLE + 1, TREBLE_MIDDLE - 1, BASS_MIDDLE + 1, BASS_MIDDLE - 1];
const SEL_FILL = 'rgba(37,99,235,0.13)';
const SEL_STROKE = 'rgba(37,99,235,0.7)';
const BEAM_THICK = 5;
const BEAM_GAP = 3.5;
const BEAM_MAX_SLOPE = 0.25; // px per px
const BEAM_MAX_RISE = 2.5 * STAFF_SPACE; // total rise across a group
const BEAM_MIN_CLEAR = 2.3 * STAFF_SPACE; // shortest stem from the outer notehead to the beam

/**
 * Beams for one measure: the stem-end y for each beamed note plus the beam
 * polygons. Beams are horizontal by default; when `diagonal` is set they slope
 * to follow the outer pitches (clamped, and kept clear of the noteheads).
 */
function computeMeasureBeams(pm: PlacedMeasure, diagonal: boolean): { beamProps: Map<string, { stemUp: boolean; tipY: number }>; elements: JSX.Element[] } {
  const beamProps = new Map<string, { stemUp: boolean; tipY: number }>();
  const elements: JSX.Element[] = [];
  for (const staff of ['treble', 'bass'] as Staff[]) {
    for (const group of beamGroups(pm.measure.events, staff, pm.ts)) {
      const allDs = group.flatMap((ev) => ev.pitches.map(pitchToDiatonic));
      const stemUp = stemUpForChord(allDs, staff);
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
function restClearShift(pm: PlacedMeasure, staff: Staff, startTick: number, beamProps: Map<string, { stemUp: boolean; tipY: number }>): number {
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
  if (!stemUpForChord(prev.pitches.map(pitchToDiatonic), staff)) return 0; // down-stem flags stay left of the notehead
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
 * Tuplet brackets / numbers for one measure. A beamed tuplet (e.g. eighth-note
 * triplets) shows just the number over the beam; an unbeamed one (quarter
 * triplets) gets a bracket with the number, clear of the stems.
 */
function renderMeasureTuplets(pm: PlacedMeasure, beamProps: Map<string, { stemUp: boolean; tipY: number }>): JSX.Element[] {
  const els: JSX.Element[] = [];
  const groups = new Map<string, ScoreEvent[]>();
  for (const ev of pm.measure.events) {
    if (!ev.tuplet) continue;
    const arr = groups.get(ev.tuplet.id) ?? [];
    arr.push(ev);
    groups.set(ev.tuplet.id, arr);
  }
  for (const [tid, raw] of groups) {
    const members = raw.slice().sort((a, b) => a.startTick - b.startTick);
    if (members.length === 0) continue;
    const staff = members[0].staff;
    const notes = members.filter((e): e is NoteEvent => e.kind === 'note');
    const allDs = notes.flatMap((e) => e.pitches.map(pitchToDiatonic));
    const stemUp = allDs.length ? stemUpForChord(allDs, staff) : staff === 'treble';
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
        : (stemUp ? TOP_Y - 14 : BOTTOM_Y + 14);
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

/** Ties of value for one system: a flat arc per tied pitch (split at the line edges when it wraps). */
function renderSystemTies(layout: SystemLayout, ties: TieConn[]): JSX.Element[] {
  const els: JSX.Element[] = [];
  const leftEdge = layout.header + 4;
  const rightEdge = layout.width - 4;
  ties.forEach((t, i) => {
    const pmFrom = layout.measures.find((p) => p.index === t.fromIndex);
    const pmTo = layout.measures.find((p) => p.index === t.toIndex);
    if (!pmFrom && !pmTo) return; // neither endpoint is on this line
    const y = diatonicToY(t.diatonic);
    const x1 = pmFrom ? measureTickToX(pmFrom, t.fromTick) + NOTEHEAD_RX + 1.5 : leftEdge;
    const x2 = pmTo ? measureTickToX(pmTo, t.toTick) - NOTEHEAD_RX - 1.5 : rightEdge;
    if (x2 - x1 < 5) return;
    const middle = t.staff === 'treble' ? TREBLE_MIDDLE : BASS_MIDDLE;
    const dir = t.diatonic >= middle ? -1 : 1; // higher notes: arc above; lower: below
    const cx = (x1 + x2) / 2;
    const bulge = 0.85 * STAFF_SPACE;
    const d = `M ${x1} ${y} Q ${cx} ${y + dir * bulge} ${x2} ${y} Q ${cx} ${y + dir * (bulge - 2.4)} ${x1} ${y} Z`;
    els.push(<path key={`tie-${t.fromIndex}-${t.toIndex}-${t.diatonic}-${i}`} d={d} fill="#1a1a1a" pointerEvents="none" />);
  });
  return els;
}

const GHOST_COLOR: Record<PlaceAction, string> = {
  create: '#94a3b8',
  chord: '#2563eb',
  delete: '#dc2626',
  blocked: '#dc2626',
};
const GHOST_OPACITY: Record<PlaceAction, number> = {
  create: 0.6,
  chord: 0.65,
  delete: 0.65,
  blocked: 0.25,
};

interface PlaceHover {
  mode: 'place';
  measureIndex: number;
  tick: number;
  diatonic: number;
  alter: Alter; // effective alteration (key signature + accidentals so far in the measure)
  staff: Staff;
  action: PlaceAction;
}
interface TargetHover {
  mode: 'target';
  measureIndex: number;
  eventId: string;
  diatonic: number | null;
  hx: number;
  hy: number;
}
interface RepeatHover {
  mode: 'repeat';
  measureIndex: number;
  edge: 'start' | 'end';
}
type Hover = PlaceHover | TargetHover | RepeatHover;

interface SystemProps {
  layout: SystemLayout;
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
  onAction: (action: ScoreAction) => void;
  onAfterApply: () => void;
  onPreviewNote: (pitches: Pitch[]) => void;
  onSetCursor: (tick: number) => void;
  onHoverNote: (name: string | null) => void;
  ties: TieConn[];
}

export function System(props: SystemProps) {
  const {
    layout,
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
    onAction,
    onAfterApply,
    onPreviewNote,
    onSetCursor,
    onHoverNote,
    ties,
  } = props;

  // effective key signature of a given measure index in this system
  function keyAt(index: number): number {
    return layout.measures.find((p) => p.index === index)?.keySig ?? headerKeySig;
  }
  // pitch the note tool would create at a diatonic, honouring a measure's key signature
  function keyedPitch(d: number, keySig: number): Pitch {
    const p = diatonicToPitch(d, 0);
    return { ...p, alter: keyAlterForStep(p.step, keySig) };
  }

  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [cursorDrag, setCursorDrag] = useState(false);
  const noteDragRef = useRef<{ measureIndex: number; eventId: string; lastD: number } | null>(null);
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const cursorDragRef = useRef(false); // a playhead-handle interaction is in progress
  // vertical drag on a |: sign to set the play count
  const repeatDragRef = useRef<{ index: number; startTimes: number; startY: number; lastTimes: number } | null>(null);
  const [repeatDragIndex, setRepeatDragIndex] = useState<number | null>(null); // show the count (even ×1) while dragging
  const lastRepeatInsertRef = useRef<{ key: string; t: number } | null>(null); // so a double-click on empty space doesn't insert+delete
  const CURSOR_GRID = Math.max(1, Math.round(TICKS_PER_QUARTER / 4)); // snap cursor to 16th-notes

  const placing = tool.kind === 'note' || tool.kind === 'rest';
  const modal = tool.kind === 'accidental' || tool.kind === 'eraser' || tool.kind === 'dot' || tool.kind === 'tuplet' || tool.kind === 'tie';

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

    let tick: number | null = null;
    for (const e of pm.measure.events) {
      const ex = measureTickToX(pm, e.startTick);
      if (Math.abs(ex - x) <= 11) {
        tick = e.startTick;
        break;
      }
    }
    if (tick === null) {
      const grid = durationTicks(duration);
      const raw = measureXToTickRaw(pm, x);
      tick = clamp(Math.round(raw / grid) * grid, 0, Math.max(0, pm.capacityTicks - grid));
    }
    if (pm.pickup) {
      // pack the anacrusis from the start: appending never leaves a leading gap,
      // so the upbeat begins on its first note.
      const contentEnd = pm.measure.events.reduce((mx, e) => Math.max(mx, e.startTick + eventTicks(e)), 0);
      tick = Math.min(tick, contentEnd);
    }

    const d = clamp(yToDiatonic(y), 5, 50);
    const staff = staffForDiatonic(d);
    const base = diatonicToPitch(d, 0);
    const alter = effectiveAlterForNew(pm.measure.events, pm.keySig, staff, base.step, base.octave, tick);
    const action =
      tool.kind === 'rest'
        ? classifyRest(pm.measure.events, tick, duration, pm.capacityTicks, staff)
        : classifyNote(pm.measure.events, tick, base, duration, pm.capacityTicks, staff);
    return { mode: 'place', measureIndex: pm.index, tick, diatonic: d, alter, staff, action };
  }

  // report the hovered ghost-note's name (key signature + measure accidentals) to the parent
  const lastHoverName = useRef<string | null>(null);
  function setHoverState(h: Hover | null) {
    setHover(h);
    const name =
      h?.mode === 'place' && tool.kind === 'note' && (h.action === 'create' || h.action === 'chord')
        ? pitchNameIt({ ...diatonicToPitch(h.diatonic, 0), alter: h.alter })
        : null;
    if (name !== lastHoverName.current) {
      lastHoverName.current = name;
      onHoverNote(name);
    }
  }

  // nearest notehead to (x,y); leftPad widens the catch zone to the left (for accidentals)
  function pickNotehead(x: number, y: number, leftPad: number) {
    let best: { measureIndex: number; eventId: string; diatonic: number; hx: number; hy: number; dist: number } | null = null;
    for (const pm of layout.measures) {
      for (const ev of pm.measure.events) {
        if (ev.kind !== 'note') continue;
        const ex = measureTickToX(pm, ev.startTick);
        const ds = ev.pitches.map(pitchToDiatonic);
        const offs = secondOffsets(ds, stemUpForChord(ds, ev.staff), noteheadHalfWidth(ev.duration.value));
        for (let pi = 0; pi < ds.length; pi++) {
          const d = ds[pi];
          const ey = diatonicToY(d);
          const hx = ex + offs[pi];
          const dx = x - hx;
          const dy = y - ey;
          const inX = dx <= NOTEHEAD_RX + 4 && dx >= -(NOTEHEAD_RX + 4 + leftPad);
          if (inX && Math.abs(dy) <= NOTEHEAD_RY + 4) {
            const dist = Math.hypot(dx, dy);
            if (!best || dist < best.dist) best = { measureIndex: pm.index, eventId: ev.id, diatonic: d, hx, hy: ey, dist };
          }
        }
      }
    }
    return best;
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
    if (!hit) return null;
    return { mode: 'target', measureIndex: hit.measureIndex, eventId: hit.eventId, diatonic: hit.diatonic, hx: hit.hx, hy: hit.hy };
  }

  // mousedown on a notehead with the note tool starts a diatonic drag-to-move
  function handleMouseDown(e: React.MouseEvent) {
    suppressClickRef.current = false; // fresh press: clear any stale click suppression
    if (e.altKey || tool.kind !== 'note') return;
    const pt = localPoint(e.clientX, e.clientY);
    if (!pt) return;
    const hit = pickNotehead(pt.x, pt.y, 0);
    if (hit) {
      noteDragRef.current = { measureIndex: hit.measureIndex, eventId: hit.eventId, lastD: hit.diatonic };
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
      const d = clamp(yToDiatonic(pt.y), 5, 50);
      if (d !== nd.lastD) {
        onAction({ type: 'MOVE_NOTE', measureIndex: nd.measureIndex, eventId: nd.eventId, fromDiatonic: nd.lastD, toDiatonic: d });
        nd.lastD = d;
        movedRef.current = true;
        if (previewOnCreate) onPreviewNote([keyedPitch(d, keyAt(nd.measureIndex))]);
      }
      return;
    }
    if (placing) setHoverState(computePlace(pt.x, pt.y));
    else if (modal) setHoverState(computeTarget(pt.x, pt.y));
    else if (tool.kind === 'repeat') setHoverState(computeRepeatHover(pt.x));
    else setHoverState(null);
  }

  function handleMouseUp() {
    setCursorDrag(false);
    if (cursorDragRef.current) {
      cursorDragRef.current = false;
      suppressClickRef.current = true; // dragging/clicking the playhead handle must not place a note
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
        // store a non-explicit note: it follows the key signature and any
        // accidental already in effect in the measure
        const pitch = diatonicToPitch(target.diatonic, 0);
        onAction({ type: 'CLICK_NOTE', measureIndex: target.measureIndex, tick: target.tick, pitch, duration });
        if (previewOnCreate && (target.action === 'create' || target.action === 'chord'))
          onPreviewNote([{ ...pitch, alter: target.alter }]); // sound it with its effective alteration

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
      if (previewOnCreate) onPreviewNote([diatonicToPitch(hit.diatonic, tool.alter)]);
    } else if (tool.kind === 'eraser') {
      onAction({ type: 'ERASE', measureIndex: hit.measureIndex, eventId: hit.eventId, diatonic: hit.diatonic });
    } else if (tool.kind === 'dot') {
      onAction({ type: 'SET_DOTS', measureIndex: hit.measureIndex, eventId: hit.eventId, dots: tool.dots });
    } else if (tool.kind === 'tuplet') {
      onAction({ type: 'MAKE_TUPLET', measureIndex: hit.measureIndex, eventId: hit.eventId });
    } else if (tool.kind === 'tie') {
      onAction({ type: 'TOGGLE_TIE', measureIndex: hit.measureIndex, eventId: hit.eventId });
    }
    onAfterApply();
  }

  // ---- ghost / hover highlight ----
  let overlay: JSX.Element | null = null;
  if (hover?.mode === 'place') {
    const pm = layout.measures.find((p) => p.index === hover.measureIndex);
    if (pm) {
      const gx = measureTickToX(pm, hover.tick);
      const color = GHOST_COLOR[hover.action];
      const op = GHOST_OPACITY[hover.action];
      const gMiddle = hover.staff === 'treble' ? TREBLE_MIDDLE : BASS_MIDDLE;
      overlay =
        tool.kind === 'rest' ? (
          <RestView duration={duration} x={gx} color={color} middle={gMiddle} opacity={op} />
        ) : (
          <NoteView pitches={[{ ...diatonicToPitch(hover.diatonic, 0), alter: hover.alter }]} duration={duration} staff={hover.staff} keySignature={pm.keySig} x={gx} color={color} opacity={op} />
        );
    }
  } else if (hover?.mode === 'repeat') {
    const pm = layout.measures.find((p) => p.index === hover.measureIndex);
    if (pm) overlay = repeatSignEls(pm, hover.edge, '#2563eb', 0.45, 'rpthover');
  } else if (hover?.mode === 'target') {
    const color = tool.kind === 'accidental' ? '#2563eb' : tool.kind === 'dot' ? '#0891b2' : tool.kind === 'tuplet' ? '#7c3aed' : tool.kind === 'tie' ? '#0ea5e9' : '#dc2626';
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
    const offs = secondOffsets(ds, stemUpForChord(ds, ev.staff), noteheadHalfWidth(ev.duration.value));
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

  // ---- repeat signs (|: / :|) ----
  function repeatSignEls(pm: PlacedMeasure, edge: 'start' | 'end', color: string, opacity: number, keyPrefix: string) {
    const start = edge === 'start';
    const x = start ? pm.leftX + 2.5 : pm.leftX + pm.contentW - 2.5;
    const dir = start ? 1 : -1; // thin line + dots sit inside the measure
    return (
      <g key={`${keyPrefix}-${pm.index}-${edge}`} opacity={opacity} pointerEvents="none">
        <line x1={x} x2={x} y1={TOP_Y} y2={BOTTOM_Y} stroke={color} strokeWidth={3.4} />
        <line x1={x + dir * 5} x2={x + dir * 5} y1={TOP_Y} y2={BOTTOM_Y} stroke={color} strokeWidth={1.2} />
        {REPEAT_DOT_DS.map((d) => (
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
        y={TOP_Y - 16}
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
    const zones: JSX.Element[] = [];
    if (pm.measure.repeatStart) {
      zones.push(
        <rect
          key={`rz-s-${pm.index}`}
          x={pm.leftX - 2}
          y={TOP_Y - 32}
          width={19}
          height={BOTTOM_Y - TOP_Y + 44}
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
          y={TOP_Y - 32}
          width={19}
          height={BOTTOM_Y - TOP_Y + 44}
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

  // mid-line key/time change: double barline, cancellation naturals, new key, new time
  function renderChange(pm: PlacedMeasure) {
    const baseX = pm.leftX + 4;
    const naturalsCount = pm.keyChanged ? keyChangeNaturals(pm.prevKeySig, pm.keySig, 0).length : 0;
    const newCount = Math.abs(pm.keySig);
    const timeX = baseX + (pm.keyChanged ? (naturalsCount + newCount) * KEYSIG_STEP + 12 : 6);
    return (
      <g pointerEvents="none">
        <line x1={pm.leftX - 3} x2={pm.leftX - 3} y1={TOP_Y} y2={BOTTOM_Y} stroke="#222" strokeWidth={BAR_LINE_WIDTH} />
        {pm.keyChanged &&
          [0, -14].flatMap((off) => [
            ...keyChangeNaturals(pm.prevKeySig, pm.keySig, off).map((n, i) => (
              <text key={`nat${off}-${i}`} x={baseX + i * KEYSIG_STEP} y={diatonicToY(n.diatonic)} fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
                {SMUFL.accidentals['0']}
              </text>
            )),
            ...keySignatureAccidentals(pm.keySig, off).map((a, j) => (
              <text key={`acc${off}-${j}`} x={baseX + (naturalsCount + j) * KEYSIG_STEP} y={diatonicToY(a.diatonic)} fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
                {SMUFL.accidentals[String(a.alter)]}
              </text>
            )),
          ])}
        {pm.tsChanged &&
          [
            { numY: diatonicToY(36), denY: diatonicToY(32) },
            { numY: diatonicToY(24), denY: diatonicToY(20) },
          ].map((r, i) => (
            <Fragment key={`ts${i}`}>
              <text x={timeX} y={r.numY} textAnchor="middle" dominantBaseline="central" fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
                {timeSigString(pm.ts.numerator)}
              </text>
              <text x={timeX} y={r.denY} textAnchor="middle" dominantBaseline="central" fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
                {timeSigString(pm.ts.denominator)}
              </text>
            </Fragment>
          ))}
      </g>
    );
  }

  const braceMid = (TOP_Y + BOTTOM_Y) / 2;
  const bracePath = `M ${BRACE_X} ${TOP_Y} C ${BRACE_X - 7} ${TOP_Y + 20}, ${BRACE_X + 5} ${braceMid - 24}, ${BRACE_X - 3} ${braceMid} C ${BRACE_X + 5} ${braceMid + 24}, ${BRACE_X - 7} ${BOTTOM_Y - 20}, ${BRACE_X} ${BOTTOM_Y}`;

  return (
    <svg
      ref={svgRef}
      className="system"
      data-tool={tool.kind}
      width={layout.width}
      height={SYSTEM_HEIGHT}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      {/* selected-measure highlights (behind everything) */}
      {selectedMeasureIdx &&
        layout.measures
          .filter((pm) => selectedMeasureIdx.has(pm.index))
          .map((pm) => (
            <rect
              key={`selm-${pm.index}`}
              x={pm.leftX}
              y={TOP_Y - 10}
              width={pm.contentW}
              height={BOTTOM_Y - TOP_Y + 20}
              fill={SEL_FILL}
              stroke={SEL_STROKE}
              strokeWidth={1.2}
              pointerEvents="none"
            />
          ))}

      {/* staff lines */}
      {[...TREBLE_LINES, ...BASS_LINES].map((d) => {
        const y = diatonicToY(d);
        return <line key={d} x1={STAFF_LEFT} x2={layout.width} y1={y} y2={y} stroke="#222" strokeWidth={STAFF_LINE_WIDTH} />;
      })}

      {/* brace + system start line */}
      <path d={bracePath} stroke="#222" strokeWidth={2.4} fill="none" />
      <line x1={STAFF_LEFT} x2={STAFF_LEFT} y1={TOP_Y} y2={BOTTOM_Y} stroke="#222" strokeWidth={BAR_LINE_WIDTH} />

      {/* clefs */}
      <text x={CLEF_X} y={diatonicToY(32)} fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
        {SMUFL.gClef}
      </text>
      <text x={CLEF_X} y={diatonicToY(24)} fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
        {SMUFL.fClef}
      </text>

      {/* key signature in the header (both staves, restated on every system) */}
      {[0, -14].flatMap((staffOffset) =>
        keySignatureAccidentals(headerKeySig, staffOffset).map((acc, i) => (
          <text
            key={`ks${staffOffset}-${i}`}
            x={KEYSIG_X + i * KEYSIG_STEP}
            y={diatonicToY(acc.diatonic)}
            fontFamily="Bravura"
            fontSize={GLYPH_FONT_SIZE}
            fill="#222"
          >
            {SMUFL.accidentals[String(acc.alter)]}
          </text>
        )),
      )}

      {/* time signature (first system only), pushed right past the key signature */}
      {showTimeSig &&
        [
          { numY: diatonicToY(36), denY: diatonicToY(32) },
          { numY: diatonicToY(24), denY: diatonicToY(20) },
        ].map((r, i) => (
          <Fragment key={i}>
            <text x={TIME_SIG_X + keySigWidth(headerKeySig)} y={r.numY} textAnchor="middle" dominantBaseline="central" fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
              {timeSigString(headerTs.numerator)}
            </text>
            <text x={TIME_SIG_X + keySigWidth(headerKeySig)} y={r.denY} textAnchor="middle" dominantBaseline="central" fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
              {timeSigString(headerTs.denominator)}
            </text>
          </Fragment>
        ))}

      {/* measures: notes + placed rests + auto-derived rests + right barline */}
      {layout.measures.map((pm) => {
        const resolved = resolveMeasure(pm.measure.events, pm.keySig);
        const { beamProps, elements: beamEls } = computeMeasureBeams(pm, diagonalBeams);
        return (
        <Fragment key={pm.measure.id}>
          {(pm.keyChanged || pm.tsChanged) && renderChange(pm)}
          {beamEls}
          {renderMeasureTuplets(pm, beamProps)}
          {pm.measure.events.map((ev) =>
            ev.kind === 'note' ? (
              <NoteView
                key={ev.id}
                pitches={ev.pitches}
                duration={ev.duration}
                staff={ev.staff}
                keySignature={pm.keySig}
                resolve={(step, octave) => resolved.get(`${ev.id}|${step}${octave}`)}
                x={measureTickToX(pm, ev.startTick)}
                color="#1a1a1a"
                beam={beamProps.get(ev.id)}
              />
            ) : (
              <RestView
                key={ev.id}
                duration={ev.duration}
                middle={ev.staff === 'treble' ? TREBLE_MIDDLE : BASS_MIDDLE}
                x={measureTickToX(pm, ev.startTick) + restClearShift(pm, ev.staff, ev.startTick, beamProps)}
                color="#1a1a1a"
              />
            ),
          )}
          {measureRests(pm.measure.events, pm.total, !pm.pickup).map((r, i) => (
            <RestView
              key={`rest-${i}`}
              duration={r.duration}
              middle={r.staff === 'treble' ? TREBLE_MIDDLE : BASS_MIDDLE}
              x={r.whole ? measureTickToX(pm, pm.total / 2) : measureTickToX(pm, r.startTick) + restClearShift(pm, r.staff, r.startTick, beamProps)}
              color="#1a1a1a"
            />
          ))}
          {selectedNoteIds &&
            pm.measure.events
              .filter((ev): ev is Extract<ScoreEvent, { kind: 'note' }> => ev.kind === 'note' && selectedNoteIds.has(ev.id))
              .map((ev) => noteHighlight(pm, ev))}
          <line x1={pm.leftX + pm.contentW} x2={pm.leftX + pm.contentW} y1={TOP_Y} y2={BOTTOM_Y} stroke="#222" strokeWidth={BAR_LINE_WIDTH} />
          {pm.measure.repeatStart && repeatSignEls(pm, 'start', '#1a1a1a', 1, 'rpt')}
          {pm.measure.repeatStart && repeatCountEl(pm)}
          {pm.measure.repeatEnd && repeatSignEls(pm, 'end', '#1a1a1a', 1, 'rpt')}
          {repeatHitZones(pm)}
        </Fragment>
        );
      })}

      {/* ties of value */}
      {renderSystemTies(layout, ties)}

      {/* cautionary key change at the end of the line (next system starts in a new key) */}
      {layout.trailingKey &&
        (() => {
          const { fromKey, toKey } = layout.trailingKey;
          const contentRight = layout.measures.length ? Math.max(...layout.measures.map((m) => m.leftX + m.contentW)) : layout.header;
          const x0 = contentRight + 8;
          const natCount = keyChangeNaturals(fromKey, toKey, 0).length;
          return (
            <g pointerEvents="none">
              {[0, -14].flatMap((off) => [
                ...keyChangeNaturals(fromKey, toKey, off).map((n, i) => (
                  <text key={`tnat${off}-${i}`} x={x0 + i * KEYSIG_STEP} y={diatonicToY(n.diatonic)} fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
                    {SMUFL.accidentals['0']}
                  </text>
                )),
                ...keySignatureAccidentals(toKey, off).map((a, j) => (
                  <text key={`tacc${off}-${j}`} x={x0 + (natCount + j) * KEYSIG_STEP} y={diatonicToY(a.diatonic)} fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
                    {SMUFL.accidentals[String(a.alter)]}
                  </text>
                )),
              ])}
            </g>
          );
        })()}

      {/* ghost / hover highlight */}
      {overlay}

      {/* playback / cursor bar (+ drag handle when not playing) */}
      {playheadX !== null && (
        <g>
          <g pointerEvents="none">
            <rect x={playheadX - 6} y={TOP_Y - 10} width={12} height={BOTTOM_Y - TOP_Y + 20} fill="rgba(56,132,255,0.16)" />
            <line x1={playheadX} x2={playheadX} y1={TOP_Y - 16} y2={BOTTOM_Y + 10} stroke="rgba(56,132,255,0.9)" strokeWidth={1.5} />
          </g>
          {showHandle && (
            <path
              d={`M ${playheadX - 7} ${TOP_Y - 22} L ${playheadX + 7} ${TOP_Y - 22} L ${playheadX} ${TOP_Y - 10} Z`}
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
    </svg>
  );
}
