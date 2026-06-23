import { Fragment, useRef, useState } from 'react';
import { Alter, Duration, Pitch, ScoreEvent, Staff, TimeSignature } from '../music/types';
import { diatonicToPitch, durationTicks, pitchNameIt, pitchToDiatonic, staffForDiatonic } from '../music/theory';
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
  KEYSIG_X,
  KEYSIG_STEP,
  keySigWidth,
} from '../music/layout';
import { classifyNote, classifyRest, PlaceAction } from '../music/placement';
import { measureRests } from '../music/rests';
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
  TICKS_PER_QUARTER,
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
type Hover = PlaceHover | TargetHover;

interface SystemProps {
  layout: SystemLayout;
  headerTs: TimeSignature;
  headerKeySig: number;
  showTimeSig: boolean;
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
}

export function System(props: SystemProps) {
  const {
    layout,
    headerTs,
    headerKeySig,
    showTimeSig,
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
  const CURSOR_GRID = Math.max(1, Math.round(TICKS_PER_QUARTER / 4)); // snap cursor to 16th-notes

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
      tick = clamp(Math.round(raw / grid) * grid, 0, Math.max(0, pm.total - grid));
    }

    const d = clamp(yToDiatonic(y), 5, 50);
    const staff = staffForDiatonic(d);
    const base = diatonicToPitch(d, 0);
    const alter = effectiveAlterForNew(pm.measure.events, pm.keySig, staff, base.step, base.octave, tick);
    const action =
      tool.kind === 'rest'
        ? classifyRest(pm.measure.events, tick, duration, pm.total, staff)
        : classifyNote(pm.measure.events, tick, base, duration, pm.total, staff);
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
    else setHoverState(null);
  }

  function handleMouseUp() {
    setCursorDrag(false);
    if (cursorDragRef.current) {
      cursorDragRef.current = false;
      suppressClickRef.current = true; // dragging/clicking the playhead handle must not place a note
    }
    if (noteDragRef.current) {
      noteDragRef.current = null;
      if (movedRef.current) suppressClickRef.current = true; // a drag happened: don't treat it as a click
    }
  }

  function handleMouseLeave() {
    setHoverState(null);
    setCursorDrag(false);
    if (noteDragRef.current) {
      noteDragRef.current = null;
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

    // accidental / eraser
    const hit = computeTarget(pt.x, pt.y);
    if (!hit) return;
    if (tool.kind === 'accidental') {
      if (hit.diatonic === null) return;
      onAction({ type: 'SET_ACCIDENTAL', measureIndex: hit.measureIndex, eventId: hit.eventId, diatonic: hit.diatonic, alter: tool.alter });
      // sound the note with its new alteration, like creating a note does
      if (previewOnCreate) onPreviewNote([diatonicToPitch(hit.diatonic, tool.alter)]);
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
        return (
        <Fragment key={pm.measure.id}>
          {(pm.keyChanged || pm.tsChanged) && renderChange(pm)}
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
              />
            ) : (
              <RestView
                key={ev.id}
                duration={ev.duration}
                middle={ev.staff === 'treble' ? TREBLE_MIDDLE : BASS_MIDDLE}
                x={measureTickToX(pm, ev.startTick + durationTicks(ev.duration) / 2)}
                color="#1a1a1a"
              />
            ),
          )}
          {measureRests(pm.measure.events, pm.total).map((r, i) => (
            <RestView
              key={`rest-${i}`}
              duration={r.duration}
              middle={r.staff === 'treble' ? TREBLE_MIDDLE : BASS_MIDDLE}
              x={measureTickToX(pm, r.whole ? pm.total / 2 : r.startTick + durationTicks(r.duration) / 2)}
              color="#1a1a1a"
            />
          ))}
          {selectedNoteIds &&
            pm.measure.events
              .filter((ev): ev is Extract<ScoreEvent, { kind: 'note' }> => ev.kind === 'note' && selectedNoteIds.has(ev.id))
              .map((ev) => noteHighlight(pm, ev))}
          <line x1={pm.leftX + pm.contentW} x2={pm.leftX + pm.contentW} y1={TOP_Y} y2={BOTTOM_Y} stroke="#222" strokeWidth={BAR_LINE_WIDTH} />
        </Fragment>
        );
      })}

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
