import { NoteEvent, ScoreEvent, Staff, TimeSignature } from './types';
import { TICKS_PER_WHOLE } from './constants';

const EIGHTH = TICKS_PER_WHOLE / 8; // 96 ticks
const QUARTER = TICKS_PER_WHOLE / 4; // 192 ticks

/** Number of beams a note value carries (eighth = 1, 16th = 2, 32nd = 3; longer = 0). */
export function beamCount(value: number): number {
  return value === 8 ? 1 : value === 16 ? 2 : value === 32 ? 3 : 0;
}

/**
 * Eighth-note counts of each primary beaming segment for a meter, following the
 * standard rules: the beam must never hide the main beat.
 *  - simple (x/4): 4/4 -> half-bars [4,4] (never beam across the middle), 2/4 -> [4],
 *    3/4 -> all six [6], others (5/4, 7/4...) per beat;
 *  - compound (x/8 with numerator a multiple of 3): groups of three;
 *  - irregular (5/8, 7/8, 11/8, 13/8): additive accent groups (3+2, 2+2+3, ...);
 *  - cut/half (x/2): one group per half-note beat.
 */
export function eighthGroups(ts: TimeSignature): number[] {
  const { numerator: n, denominator: d } = ts;
  if (d === 8) {
    if (n % 3 === 0 && n >= 3) return Array(n / 3).fill(3); // compound: 6/8,9/8,12/8,3/8
    const fixed: Record<number, number[]> = { 5: [3, 2], 7: [2, 2, 3], 11: [3, 3, 3, 2], 13: [3, 3, 3, 2, 2] };
    return fixed[n] ?? additive(n);
  }
  if (d === 4) {
    if (n === 4) return [4, 4]; // half-bars; the mid-bar line stays visible
    if (n === 2) return [4];
    if (n === 3) return [6];
    return Array(n).fill(2); // 5/4, 7/4, ... one beat each
  }
  if (d === 2) return Array(n).fill(4); // half-note beats
  // fallback (e.g. x/16): one segment per quarter
  const eighths = Math.round((n * (TICKS_PER_WHOLE / d)) / EIGHTH);
  return additive(eighths);
}

/** Generic additive grouping (as many 3s as possible, trailing 2s): 5->3,2; 7->3,2,2; ... */
function additive(eighths: number): number[] {
  const out: number[] = [];
  let rem = eighths;
  while (rem > 0) {
    if (rem === 4) {
      out.push(2, 2);
      rem = 0;
    } else if (rem <= 2) {
      out.push(rem);
      rem = 0;
    } else {
      out.push(3);
      rem -= 3;
    }
  }
  return out;
}

/** Sub-beat (quarter) at which to split a run containing notes shorter than an eighth; null = no split. */
function subBeatTicks(ts: TimeSignature): number | null {
  // Simple meters group 16ths by the quarter beat; compound/irregular keep the
  // 16ths grouped like the eighths (no finer split).
  return ts.denominator === 4 || ts.denominator === 2 ? QUARTER : null;
}

/**
 * Beam groups for one staff: runs of 2+ consecutive beamable notes within a
 * primary segment. A run that contains 16ths (or shorter) is further split at
 * the quarter sub-beat in simple meters. Rests and non-beamable notes break a run.
 */
export function beamGroups(events: ScoreEvent[], staff: Staff, ts: TimeSignature): NoteEvent[][] {
  const groups = eighthGroups(ts);
  const bounds: number[] = [0];
  for (const g of groups) bounds.push(bounds[bounds.length - 1] + g * EIGHTH);
  const segOf = (tick: number): number => {
    for (let i = 0; i < bounds.length - 1; i++) if (tick >= bounds[i] && tick < bounds[i + 1]) return i;
    return bounds.length - 2;
  };
  const sub = subBeatTicks(ts);

  const staffEvents = events.filter((e) => e.staff === staff).slice().sort((a, b) => a.startTick - b.startTick);
  const out: NoteEvent[][] = [];
  let run: NoteEvent[] = [];
  let runSeg = -1;
  let runTid: string | null = null; // tuplet id of the current run (null = not a tuplet)

  const flush = () => {
    if (run.length === 0) return;
    const isTuplet = !!run[0].tuplet; // a tuplet beams as one group, never sub-split
    const hasShort = !isTuplet && sub !== null && run.some((e) => beamCount(e.duration.value) >= 2);
    if (hasShort && sub !== null) {
      let cur: NoteEvent[] = [];
      let curSub = -1;
      for (const e of run) {
        const s = Math.floor(e.startTick / sub);
        if (cur.length === 0 || s === curSub) {
          if (cur.length === 0) curSub = s;
          cur.push(e);
        } else {
          if (cur.length >= 2) out.push(cur);
          cur = [e];
          curSub = s;
        }
      }
      if (cur.length >= 2) out.push(cur);
    } else if (run.length >= 2) {
      out.push(run);
    }
    run = [];
    runSeg = -1;
    runTid = null;
  };

  for (const e of staffEvents) {
    if (e.kind === 'note' && beamCount(e.duration.value) >= 1) {
      const seg = segOf(e.startTick);
      const tid = e.tuplet?.id ?? null;
      const sameTuplet = tid !== null && tid === runTid;
      if (run.length === 0) {
        run = [e];
        runSeg = seg;
        runTid = tid;
      } else if (sameTuplet || (tid === null && runTid === null && seg === runSeg)) {
        // same tuplet (any segment), or plain notes within one beat segment
        run.push(e);
      } else {
        flush();
        run = [e];
        runSeg = seg;
        runTid = tid;
      }
    } else {
      flush();
    }
  }
  flush();
  return out;
}
