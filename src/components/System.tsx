import { Fragment, useRef, useState } from 'react';
import { Duration, Pitch, ScoreEvent, TimeSignature } from '../music/types';
import { diatonicToPitch, durationTicks, measureTicks, pitchToDiatonic } from '../music/theory';
import {
  SystemLayout,
  diatonicToY,
  yToDiatonic,
  tickToX,
  xToTickRaw,
  clamp,
  TREBLE_LINES,
  BASS_LINES,
} from '../music/layout';
import { classifyNote, classifyRest, PlaceAction } from '../music/placement';
import { measureRests } from '../music/rests';
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
} from '../music/constants';
import type { ScoreAction } from '../state/scoreReducer';
import { Tool } from '../state/tool';
import { Selection } from '../state/selection';
import { NoteView } from './Note';
import { RestView } from './Rest';

const TOP_Y = diatonicToY(38);
const BOTTOM_Y = diatonicToY(18);
const SEL_FILL = 'rgba(37,99,235,0.13)';
const SEL_STROKE = 'rgba(37,99,235,0.7)';

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
type Hover = PlaceHover | TargetHover;

type Drag =
  | { kind: 'measures'; start: number; current: number }
  | { kind: 'lasso'; x0: number; y0: number; x1: number; y1: number };

interface SystemProps {
  layout: SystemLayout;
  ts: TimeSignature;
  showTimeSig: boolean;
  tool: Tool;
  duration: Duration;
  previewOnCreate: boolean;
  selection: Selection | null;
  playheadX: number | null;
  onAction: (action: ScoreAction) => void;
  onAfterApply: () => void;
  onPreviewNote: (pitches: Pitch[]) => void;
  onSelectMeasures: (indices: number[]) => void;
  onSelectNotes: (ids: string[]) => void;
  onClearSelection: () => void;
}

export function System(props: SystemProps) {
  const {
    layout,
    ts,
    showTimeSig,
    tool,
    duration,
    previewOnCreate,
    selection,
    playheadX,
    onAction,
    onAfterApply,
    onPreviewNote,
    onSelectMeasures,
    onSelectNotes,
    onClearSelection,
  } = props;

  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const total = measureTicks(ts);

  const placing = tool.kind === 'note' || tool.kind === 'rest';
  const modal = tool.kind === 'accidental' || tool.kind === 'eraser';

  function localPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function measureAt(x: number) {
    return layout.measures.find((p) => x >= p.leftX && x < p.leftX + p.contentW) ?? null;
  }

  // ---- placement tools (note / rest): snap to a grid slot ----
  function computePlace(x: number, y: number): PlaceHover | null {
    const pm = measureAt(x);
    if (!pm) return null;

    let tick: number | null = null;
    for (const e of pm.measure.events) {
      const ex = tickToX(pm.leftX, pm.contentW, e.startTick, total);
      if (Math.abs(ex - x) <= 11) {
        tick = e.startTick;
        break;
      }
    }
    if (tick === null) {
      const grid = durationTicks(duration);
      const raw = xToTickRaw(pm.leftX, pm.contentW, x, total);
      tick = clamp(Math.round(raw / grid) * grid, 0, Math.max(0, total - grid));
    }

    const d = clamp(yToDiatonic(y), 5, 50);
    const action =
      tool.kind === 'rest'
        ? classifyRest(pm.measure.events, tick, duration, total)
        : classifyNote(pm.measure.events, tick, diatonicToPitch(d, 0), duration, total);
    return { mode: 'place', measureIndex: pm.index, tick, diatonic: d, action };
  }

  // ---- modal tools (accidental / eraser): hit-test an existing notehead ----
  function computeTarget(x: number, y: number): TargetHover | null {
    const leftPad = tool.kind === 'accidental' ? 20 : 0;
    let best: (TargetHover & { dist: number }) | null = null;
    for (const pm of layout.measures) {
      for (const ev of pm.measure.events) {
        if (ev.kind !== 'note') continue;
        const ex = tickToX(pm.leftX, pm.contentW, ev.startTick, total);
        for (const p of ev.pitches) {
          const d = pitchToDiatonic(p);
          const ey = diatonicToY(d);
          const dx = x - ex;
          const dy = y - ey;
          const inX = dx <= NOTEHEAD_RX + 4 && dx >= -(NOTEHEAD_RX + 4 + leftPad);
          if (inX && Math.abs(dy) <= NOTEHEAD_RY + 4) {
            const dist = Math.hypot(dx, dy);
            if (!best || dist < best.dist) {
              best = { mode: 'target', measureIndex: pm.index, eventId: ev.id, diatonic: d, hx: ex, hy: ey, dist };
            }
          }
        }
      }
    }
    if (!best) return null;
    return { mode: 'target', measureIndex: best.measureIndex, eventId: best.eventId, diatonic: best.diatonic, hx: best.hx, hy: best.hy };
  }

  function notesInRect(x0: number, y0: number, x1: number, y1: number): string[] {
    const lo = { x: Math.min(x0, x1), y: Math.min(y0, y1) };
    const hi = { x: Math.max(x0, x1), y: Math.max(y0, y1) };
    const ids = new Set<string>();
    for (const pm of layout.measures) {
      for (const ev of pm.measure.events) {
        if (ev.kind !== 'note') continue;
        const ex = tickToX(pm.leftX, pm.contentW, ev.startTick, total);
        for (const p of ev.pitches) {
          const ey = diatonicToY(pitchToDiatonic(p));
          if (ex >= lo.x && ex <= hi.x && ey >= lo.y && ey <= hi.y) ids.add(ev.id);
        }
      }
    }
    return [...ids];
  }

  // ---- pointer handlers ----
  function handleMouseDown(e: React.MouseEvent) {
    const pt = localPoint(e.clientX, e.clientY);
    if (!pt) return;
    if (tool.kind === 'select-measures') {
      const pm = measureAt(pt.x);
      if (!pm) return onClearSelection();
      setDrag({ kind: 'measures', start: pm.index, current: pm.index });
      onSelectMeasures([pm.index]);
    } else if (tool.kind === 'select-notes') {
      setDrag({ kind: 'lasso', x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
      setHover(null);
    }
  }

  function handleMouseMove(e: React.MouseEvent) {
    const pt = localPoint(e.clientX, e.clientY);
    if (!pt) return;
    if (drag?.kind === 'measures') {
      const pm = measureAt(pt.x);
      if (pm && pm.index !== drag.current) {
        setDrag({ ...drag, current: pm.index });
        const lo = Math.min(drag.start, pm.index);
        const hi = Math.max(drag.start, pm.index);
        onSelectMeasures(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
      }
      return;
    }
    if (drag?.kind === 'lasso') {
      setDrag({ ...drag, x1: pt.x, y1: pt.y });
      return;
    }
    if (placing) setHover(computePlace(pt.x, pt.y));
    else if (modal) setHover(computeTarget(pt.x, pt.y));
    else setHover(null);
  }

  function finishLasso(d: Drag & { kind: 'lasso' }) {
    const ids = notesInRect(d.x0, d.y0, d.x1, d.y1);
    if (ids.length > 0) onSelectNotes(ids);
    else onClearSelection();
  }

  function handleMouseUp() {
    if (drag?.kind === 'lasso') finishLasso(drag);
    setDrag(null);
  }

  function handleMouseLeave() {
    setHover(null);
    if (drag?.kind === 'lasso') finishLasso(drag);
    setDrag(null);
  }

  function handleClick(e: React.MouseEvent) {
    if (tool.kind === 'select-measures' || tool.kind === 'select-notes') return;
    const pt = localPoint(e.clientX, e.clientY);
    if (!pt) return;

    if (tool.kind === 'note' || tool.kind === 'rest') {
      const target = computePlace(pt.x, pt.y);
      if (!target || target.action === 'blocked') return;
      if (tool.kind === 'rest') {
        onAction({ type: 'CLICK_REST', measureIndex: target.measureIndex, tick: target.tick, duration });
      } else {
        const pitch = diatonicToPitch(target.diatonic, 0);
        onAction({ type: 'CLICK_NOTE', measureIndex: target.measureIndex, tick: target.tick, pitch, duration });
        if (previewOnCreate && (target.action === 'create' || target.action === 'chord')) onPreviewNote([pitch]);
      }
      return;
    }

    // accidental / eraser
    const hit = computeTarget(pt.x, pt.y);
    if (!hit) return;
    if (tool.kind === 'accidental') {
      if (hit.diatonic === null) return;
      onAction({ type: 'SET_ACCIDENTAL', measureIndex: hit.measureIndex, eventId: hit.eventId, diatonic: hit.diatonic, alter: tool.alter });
    } else if (tool.kind === 'eraser') {
      onAction({ type: 'ERASE', measureIndex: hit.measureIndex, eventId: hit.eventId, diatonic: hit.diatonic });
    }
    onAfterApply();
  }

  // ---- ghost / hover highlight ----
  let overlay: JSX.Element | null = null;
  if (hover?.mode === 'place') {
    const pm = layout.measures.find((p) => p.index === hover.measureIndex);
    if (pm) {
      const gx = tickToX(pm.leftX, pm.contentW, hover.tick, total);
      const color = GHOST_COLOR[hover.action];
      const op = GHOST_OPACITY[hover.action];
      overlay =
        tool.kind === 'rest' ? (
          <RestView duration={duration} x={gx} color={color} opacity={op} />
        ) : (
          <NoteView pitches={[diatonicToPitch(hover.diatonic, 0)]} duration={duration} x={gx} color={color} opacity={op} />
        );
    }
  } else if (hover?.mode === 'target') {
    const isAcc = tool.kind === 'accidental';
    const color = isAcc ? '#2563eb' : '#dc2626';
    overlay = (
      <g pointerEvents="none">
        <circle cx={hover.hx} cy={hover.hy} r={NOTEHEAD_RX + 3} fill={`${color}22`} stroke={color} strokeWidth={1.4} />
        {isAcc && tool.kind === 'accidental' && (
          <text x={hover.hx - NOTEHEAD_RX - 3} y={hover.hy} textAnchor="end" fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill={color} opacity={0.85}>
            {SMUFL.accidentals[String(tool.alter)]}
          </text>
        )}
      </g>
    );
  }

  const selectedNoteIds = selection?.kind === 'notes' ? new Set(selection.ids) : null;
  const selectedMeasureIdx = selection?.kind === 'measures' ? new Set(selection.indices) : null;

  function noteHighlight(pm: SystemLayout['measures'][number], ev: Extract<ScoreEvent, { kind: 'note' }>) {
    const ex = tickToX(pm.leftX, pm.contentW, ev.startTick, total);
    const ds = ev.pitches.map(pitchToDiatonic);
    const topY = diatonicToY(Math.max(...ds)) - NOTEHEAD_RY - 4;
    const botY = diatonicToY(Math.min(...ds)) + NOTEHEAD_RY + 4;
    return (
      <rect
        key={`sel-${ev.id}`}
        x={ex - NOTEHEAD_RX - 4}
        y={topY}
        width={2 * (NOTEHEAD_RX + 4)}
        height={botY - topY}
        rx={3}
        fill={SEL_FILL}
        stroke={SEL_STROKE}
        strokeWidth={1.2}
        pointerEvents="none"
      />
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

      {/* time signature (first system only) */}
      {showTimeSig &&
        [
          { numY: diatonicToY(36), denY: diatonicToY(32) },
          { numY: diatonicToY(24), denY: diatonicToY(20) },
        ].map((r, i) => (
          <Fragment key={i}>
            <text x={TIME_SIG_X} y={r.numY} textAnchor="middle" dominantBaseline="central" fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
              {timeSigString(ts.numerator)}
            </text>
            <text x={TIME_SIG_X} y={r.denY} textAnchor="middle" dominantBaseline="central" fontFamily="Bravura" fontSize={GLYPH_FONT_SIZE} fill="#222">
              {timeSigString(ts.denominator)}
            </text>
          </Fragment>
        ))}

      {/* measures: notes + placed rests + auto-derived rests + right barline */}
      {layout.measures.map((pm) => (
        <Fragment key={pm.measure.id}>
          {pm.measure.events.map((ev) =>
            ev.kind === 'note' ? (
              <NoteView key={ev.id} pitches={ev.pitches} duration={ev.duration} x={tickToX(pm.leftX, pm.contentW, ev.startTick, total)} color="#1a1a1a" />
            ) : (
              <RestView key={ev.id} duration={ev.duration} x={tickToX(pm.leftX, pm.contentW, ev.startTick + durationTicks(ev.duration) / 2, total)} color="#1a1a1a" />
            ),
          )}
          {measureRests(pm.measure.events, total).map((r, i) => (
            <RestView key={`rest-${i}`} duration={r.duration} x={tickToX(pm.leftX, pm.contentW, r.startTick + durationTicks(r.duration) / 2, total)} color="#1a1a1a" />
          ))}
          {selectedNoteIds &&
            pm.measure.events
              .filter((ev): ev is Extract<ScoreEvent, { kind: 'note' }> => ev.kind === 'note' && selectedNoteIds.has(ev.id))
              .map((ev) => noteHighlight(pm, ev))}
          <line x1={pm.leftX + pm.contentW} x2={pm.leftX + pm.contentW} y1={TOP_Y} y2={BOTTOM_Y} stroke="#222" strokeWidth={BAR_LINE_WIDTH} />
        </Fragment>
      ))}

      {/* lasso rectangle */}
      {drag?.kind === 'lasso' && (
        <rect
          x={Math.min(drag.x0, drag.x1)}
          y={Math.min(drag.y0, drag.y1)}
          width={Math.abs(drag.x1 - drag.x0)}
          height={Math.abs(drag.y1 - drag.y0)}
          fill="rgba(37,99,235,0.08)"
          stroke={SEL_STROKE}
          strokeWidth={1}
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}

      {/* ghost / hover highlight */}
      {overlay}

      {/* playhead */}
      {playheadX !== null && (
        <g pointerEvents="none">
          <rect x={playheadX - 6} y={TOP_Y - 10} width={12} height={BOTTOM_Y - TOP_Y + 20} fill="rgba(56,132,255,0.16)" />
          <line x1={playheadX} x2={playheadX} y1={TOP_Y - 10} y2={BOTTOM_Y + 10} stroke="rgba(56,132,255,0.9)" strokeWidth={1.5} />
        </g>
      )}
    </svg>
  );
}
