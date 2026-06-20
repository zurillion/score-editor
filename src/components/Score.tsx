import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Duration, Pitch, ScoreState } from '../music/types';
import { measureTicks } from '../music/theory';
import { LayoutMode, layoutSystems, tickToX, clamp } from '../music/layout';
import { SYSTEM_HEIGHT, SYSTEM_GAP } from '../music/constants';
import type { ScoreAction } from '../state/scoreReducer';
import { Tool } from '../state/tool';
import { System } from './System';

interface ScoreProps {
  state: ScoreState;
  mode: LayoutMode;
  tool: Tool;
  duration: Duration;
  previewOnCreate: boolean;
  playheadTick: number | null;
  onAction: (action: ScoreAction) => void;
  onAfterApply: () => void;
  onPreviewNote: (pitches: Pitch[]) => void;
}

export function Score({
  state,
  mode,
  tool,
  duration,
  previewOnCreate,
  playheadTick,
  onAction,
  onAfterApply,
  onPreviewNote,
}: ScoreProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(1000);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const systems = layoutSystems(state.measures, state.timeSignature, mode, containerWidth);
  const total = measureTicks(state.timeSignature);

  // ---- locate the playhead ----
  let phSystem = -1;
  let phX: number | null = null;
  if (playheadTick !== null && state.measures.length > 0) {
    const mi = clamp(Math.floor(playheadTick / total), 0, state.measures.length - 1);
    const tin = clamp(playheadTick - mi * total, 0, total);
    for (let s = 0; s < systems.length; s++) {
      const pm = systems[s].measures.find((p) => p.index === mi);
      if (pm) {
        phSystem = s;
        phX = tickToX(pm.leftX, pm.contentW, tin, total);
        break;
      }
    }
  }

  // ---- auto-scroll to follow the playhead ----
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || phX === null) return;
    if (mode === 'horizontal') {
      el.scrollLeft = Math.max(0, phX - el.clientWidth * 0.4);
    } else if (phSystem >= 0) {
      el.scrollTop = Math.max(0, phSystem * (SYSTEM_HEIGHT + SYSTEM_GAP) - 30);
    }
  }, [phX, phSystem, mode]);

  return (
    <div className="score-scroll" ref={scrollRef} data-mode={mode}>
      <div className="score-inner">
        {systems.map((sys, i) => (
          <System
            key={i}
            layout={sys}
            ts={state.timeSignature}
            showTimeSig={i === 0}
            tool={tool}
            duration={duration}
            previewOnCreate={previewOnCreate}
            playheadX={i === phSystem ? phX : null}
            onAction={onAction}
            onAfterApply={onAfterApply}
            onPreviewNote={onPreviewNote}
          />
        ))}
      </div>
    </div>
  );
}
