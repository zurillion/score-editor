import { Fragment, useRef, useState } from 'react';
import { Duration, TimeSignature } from '../music/types';
import { diatonicToPitch, durationTicks, measureTicks } from '../music/theory';
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
} from '../music/constants';
import type { ScoreAction } from '../state/scoreReducer';
import { NoteView } from './Note';
import { RestView } from './Rest';

const TOP_Y = diatonicToY(38);
const BOTTOM_Y = diatonicToY(18);

const GHOST_COLOR: Record<PlaceAction, string> = {
  create: '#94a3b8',
  chord: '#2563eb',
  delete: '#dc2626',
  blocked: '#dc2626',
};
const GHOST_OPACITY: Record<PlaceAction, number> = {
  create: 0.5,
  chord: 0.6,
  delete: 0.65,
  blocked: 0.25,
};

interface Hover {
  measureIndex: number;
  tick: number;
  diatonic: number;
  action: PlaceAction;
}

interface SystemProps {
  layout: SystemLayout;
  ts: TimeSignature;
  showTimeSig: boolean;
  tool: 'note' | 'rest';
  duration: Duration;
  accidental: -1 | 0 | 1;
  playheadX: number | null;
  onAction: (action: ScoreAction) => void;
}

export function System({ layout, ts, showTimeSig, tool, duration, accidental, playheadX, onAction }: SystemProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const total = measureTicks(ts);

  function computeTarget(clientX: number, clientY: number): Hover | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const pm = layout.measures.find((p) => x >= p.leftX && x < p.leftX + p.contentW);
    if (!pm) return null;

    // Snap to an existing event when the pointer is close to its head...
    let tick: number | null = null;
    for (const e of pm.measure.events) {
      const ex = tickToX(pm.leftX, pm.contentW, e.startTick, total);
      if (Math.abs(ex - x) <= 11) {
        tick = e.startTick;
        break;
      }
    }
    // ...otherwise snap to the grid defined by the selected duration.
    if (tick === null) {
      const grid = durationTicks(duration);
      const raw = xToTickRaw(pm.leftX, pm.contentW, x, total);
      tick = clamp(Math.round(raw / grid) * grid, 0, Math.max(0, total - grid));
    }

    const d = clamp(yToDiatonic(y), 5, 50);
    const pitch = diatonicToPitch(d, accidental);
    const action =
      tool === 'note'
        ? classifyNote(pm.measure.events, tick, pitch, duration, total)
        : classifyRest(pm.measure.events, tick, duration, total);

    return { measureIndex: pm.index, tick, diatonic: d, action };
  }

  function handleMove(e: React.MouseEvent) {
    setHover(computeTarget(e.clientX, e.clientY));
  }
  function handleClick(e: React.MouseEvent) {
    const target = computeTarget(e.clientX, e.clientY);
    if (!target || target.action === 'blocked') return;
    if (tool === 'note') {
      onAction({
        type: 'CLICK_NOTE',
        measureIndex: target.measureIndex,
        tick: target.tick,
        pitch: diatonicToPitch(target.diatonic, accidental),
        duration,
      });
    } else {
      onAction({ type: 'CLICK_REST', measureIndex: target.measureIndex, tick: target.tick, duration });
    }
  }

  // ---- ghost ----
  let ghost: JSX.Element | null = null;
  if (hover) {
    const pm = layout.measures.find((p) => p.index === hover.measureIndex);
    if (pm) {
      const gx = tickToX(pm.leftX, pm.contentW, hover.tick, total);
      const color = GHOST_COLOR[hover.action];
      const op = GHOST_OPACITY[hover.action];
      ghost =
        tool === 'note' ? (
          <NoteView pitches={[diatonicToPitch(hover.diatonic, accidental)]} duration={duration} x={gx} color={color} opacity={op} />
        ) : (
          <RestView duration={duration} x={gx} color={color} opacity={op} />
        );
    }
  }

  const braceMid = (TOP_Y + BOTTOM_Y) / 2;
  const bracePath = `M ${BRACE_X} ${TOP_Y} C ${BRACE_X - 7} ${TOP_Y + 20}, ${BRACE_X + 5} ${braceMid - 24}, ${BRACE_X - 3} ${braceMid} C ${BRACE_X + 5} ${braceMid + 24}, ${BRACE_X - 7} ${BOTTOM_Y - 20}, ${BRACE_X} ${BOTTOM_Y}`;

  return (
    <svg
      ref={svgRef}
      className="system"
      width={layout.width}
      height={SYSTEM_HEIGHT}
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
      onClick={handleClick}
    >
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

      {/* measures: events + right barline */}
      {layout.measures.map((pm) => (
        <Fragment key={pm.measure.id}>
          {pm.measure.events.map((ev) => {
            const x = tickToX(pm.leftX, pm.contentW, ev.startTick, total);
            return ev.kind === 'note' ? (
              <NoteView key={ev.id} pitches={ev.pitches} duration={ev.duration} x={x} color="#1a1a1a" />
            ) : (
              <RestView key={ev.id} duration={ev.duration} x={x} color="#1a1a1a" />
            );
          })}
          <line x1={pm.leftX + pm.contentW} x2={pm.leftX + pm.contentW} y1={TOP_Y} y2={BOTTOM_Y} stroke="#222" strokeWidth={BAR_LINE_WIDTH} />
        </Fragment>
      ))}

      {/* ghost preview */}
      {ghost}

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
