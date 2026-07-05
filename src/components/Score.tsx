import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Duration, Pitch, ScoreState } from '../music/types';
import { pitchToDiatonic } from '../music/theory';
import { scoreMeta, measureIndexAtTick } from '../music/meta';
import { resolveTies } from '../music/ties';
import { LayoutMode, layoutSystems, measureTickToX, diatonicToY, clamp } from '../music/layout';
import { SYSTEM_HEIGHT, SYSTEM_GAP } from '../music/constants';
import type { ScoreAction } from '../state/scoreReducer';
import { Tool } from '../state/tool';
import { Selection } from '../state/selection';
import { System } from './System';

export interface SystemRange {
  first: number;
  last: number;
}

interface ScoreProps {
  state: ScoreState;
  mode: LayoutMode;
  tool: Tool;
  duration: Duration;
  diagonalBeams: boolean;
  previewOnCreate: boolean;
  selection: Selection | null;
  playheadTick: number | null;
  cursorTick: number;
  playOnly?: boolean; // shared "listen" view: no editing interactions
  onAction: (action: ScoreAction) => void;
  onAfterApply: () => void;
  onPreviewNote: (pitches: Pitch[]) => void;
  onSelectMeasures: (indices: number[]) => void;
  onSelectNotes: (ids: string[]) => void;
  onClearSelection: () => void;
  onSetCursor: (tick: number) => void;
  onHoverNote: (name: string | null) => void;
  onLayout: (ranges: SystemRange[]) => void;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const STRIDE = SYSTEM_HEIGHT + SYSTEM_GAP;
const PAD = 16; // .score-inner padding

export function Score({
  state,
  mode,
  tool,
  duration,
  diagonalBeams,
  previewOnCreate,
  selection,
  playheadTick,
  cursorTick,
  playOnly = false,
  onAction,
  onAfterApply,
  onPreviewNote,
  onSelectMeasures,
  onSelectNotes,
  onClearSelection,
  onSetCursor,
  onHoverNote,
  onLayout,
}: ScoreProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1000);
  const [lassoRect, setLassoRect] = useState<Rect | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const meta = scoreMeta(state);
  const systems = layoutSystems(state.measures, meta.measures, mode, containerWidth);
  const ties = resolveTies(state, meta);

  // report system measure-ranges so the parent can move the cursor by whole rows
  const rangesKey = systems.map((s) => (s.measures.length ? `${s.measures[0].index}-${s.measures[s.measures.length - 1].index}` : '')).join('|');
  useEffect(() => {
    const ranges = systems
      .filter((s) => s.measures.length)
      .map((s) => ({ first: s.measures[0].index, last: s.measures[s.measures.length - 1].index }));
    onLayout(ranges);
  }, [rangesKey, onLayout]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- locate the bar (live playhead while playing, else the persistent cursor) ----
  const barTick = playheadTick !== null ? playheadTick : cursorTick;
  const showHandle = playheadTick === null;
  let barSystem = -1;
  let barX: number | null = null;
  if (state.measures.length > 0) {
    const mi = measureIndexAtTick(meta, barTick);
    const mm = meta.measures[mi];
    const tin = clamp(barTick - mm.startTick, 0, mm.total);
    for (let s = 0; s < systems.length; s++) {
      const pm = systems[s].measures.find((p) => p.index === mi);
      if (pm) {
        barSystem = s;
        barX = measureTickToX(pm, tin);
        break;
      }
    }
  }

  // ---- auto-scroll to follow the playhead (only while playing) ----
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || playheadTick === null || barX === null) return;
    if (mode === 'horizontal') {
      el.scrollLeft = Math.max(0, barX - el.clientWidth * 0.4);
    } else if (barSystem >= 0) {
      el.scrollTop = Math.max(0, barSystem * STRIDE - 30);
    }
  }, [playheadTick, barX, barSystem, mode]);

  // ---- selection drag (measures / note lasso), tracked on window so it survives leaving a staff ----
  function clientToContent(cx: number, cy: number): { x: number; y: number } {
    const r = innerRef.current!.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  }
  function measureAtContent(x: number, y: number): number | null {
    const i = clamp(Math.floor((y - PAD) / STRIDE), 0, systems.length - 1);
    const sys = systems[i];
    if (!sys || sys.measures.length === 0) return null;
    const lx = x - PAD;
    const pm =
      sys.measures.find((p) => lx >= p.leftX && lx < p.leftX + p.contentW) ??
      (lx < sys.measures[0].leftX ? sys.measures[0] : sys.measures[sys.measures.length - 1]);
    return pm.index;
  }
  function notesInContentRect(r: Rect): string[] {
    const ids = new Set<string>();
    systems.forEach((sys, i) => {
      const top = PAD + i * STRIDE;
      sys.measures.forEach((pm) => {
        pm.measure.events.forEach((ev) => {
          if (ev.kind !== 'note') return;
          const ncx = PAD + measureTickToX(pm, ev.startTick);
          for (const p of ev.pitches) {
            const ncy = top + diatonicToY(pitchToDiatonic(p));
            if (ncx >= r.left && ncx <= r.left + r.width && ncy >= r.top && ncy <= r.top + r.height) {
              ids.add(ev.id);
              break;
            }
          }
        });
      });
    });
    return [...ids];
  }
  function autoScroll(clientX: number, clientY: number) {
    const el = scrollRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const m = 30;
    if (clientY < r.top + m) el.scrollTop -= (r.top + m - clientY) * 0.5;
    else if (clientY > r.bottom - m) el.scrollTop += (clientY - (r.bottom - m)) * 0.5;
    if (clientX < r.left + m) el.scrollLeft -= (r.left + m - clientX) * 0.5;
    else if (clientX > r.right - m) el.scrollLeft += (clientX - (r.right - m)) * 0.5;
  }

  function onInnerMouseDown(e: React.MouseEvent) {
    if (playOnly || e.button !== 0 || e.altKey) return;
    if (tool.kind !== 'select-measures' && tool.kind !== 'select-notes') return;
    const start = clientToContent(e.clientX, e.clientY);
    const isMeasures = tool.kind === 'select-measures';
    let startIdx = -1;
    if (isMeasures) {
      const idx = measureAtContent(start.x, start.y);
      if (idx === null) return;
      startIdx = idx;
      onSelectMeasures([idx]);
    } else {
      onClearSelection();
      setLassoRect({ left: start.x, top: start.y, width: 0, height: 0 });
    }

    const onMove = (ev: MouseEvent) => {
      autoScroll(ev.clientX, ev.clientY);
      const p = clientToContent(ev.clientX, ev.clientY);
      if (isMeasures) {
        const idx = measureAtContent(p.x, p.y);
        if (idx !== null) {
          const lo = Math.min(startIdx, idx);
          const hi = Math.max(startIdx, idx);
          onSelectMeasures(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
        }
      } else {
        const rect: Rect = {
          left: Math.min(start.x, p.x),
          top: Math.min(start.y, p.y),
          width: Math.abs(p.x - start.x),
          height: Math.abs(p.y - start.y),
        };
        setLassoRect(rect);
        onSelectNotes(notesInContentRect(rect));
      }
    };
    const onUp = () => {
      setLassoRect(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div className="score-scroll" ref={scrollRef} data-mode={mode}>
      <div className="score-inner" ref={innerRef} onMouseDown={onInnerMouseDown}>
        {systems.map((sys, i) => (
          <System
            key={i}
            layout={sys}
            headerTs={sys.headerTs}
            headerKeySig={sys.headerKeySig}
            showTimeSig={i === 0 || sys.headerTsChanged}
            diagonalBeams={diagonalBeams}
            tool={tool}
            duration={duration}
            previewOnCreate={previewOnCreate}
            selection={selection}
            playheadX={i === barSystem ? barX : null}
            showHandle={showHandle}
            playOnly={playOnly}
            onAction={onAction}
            onAfterApply={onAfterApply}
            onPreviewNote={onPreviewNote}
            onSetCursor={onSetCursor}
            onHoverNote={onHoverNote}
            ties={ties}
          />
        ))}
        {lassoRect && (
          <div
            className="lasso"
            style={{ left: lassoRect.left, top: lassoRect.top, width: lassoRect.width, height: lassoRect.height }}
          />
        )}
      </div>
    </div>
  );
}
