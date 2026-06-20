import { Duration, DurationValue, ScoreEvent } from './types';
import { durationTicks } from './theory';

export interface RestSeg {
  startTick: number;
  duration: Duration;
}

// Candidate rest durations (largest first), with and without a single dot.
const CANDIDATES: { value: DurationValue; dots: 0 | 1; ticks: number }[] = (() => {
  const list: { value: DurationValue; dots: 0 | 1; ticks: number }[] = [];
  for (const value of [1, 2, 4, 8, 16, 32] as DurationValue[]) {
    for (const dots of [1, 0] as const) {
      list.push({ value, dots, ticks: durationTicks({ value, dots }) });
    }
  }
  return list.sort((a, b) => b.ticks - a.ticks);
})();

/** Greedily fill a gap [start, start+len) with the fewest standard rests. */
function fillGap(start: number, len: number): RestSeg[] {
  const out: RestSeg[] = [];
  let pos = start;
  let rem = len;
  let guard = 0;
  while (rem > 0 && guard++ < 64) {
    const c = CANDIDATES.find((cand) => cand.ticks <= rem);
    if (!c) break;
    out.push({ startTick: pos, duration: { value: c.value, dots: c.dots } });
    pos += c.ticks;
    rem -= c.ticks;
  }
  return out;
}

/**
 * Rests are not stored: they are derived to fill every gap left by the notes of
 * a measure (before the first note, between notes, and up to the barline). A
 * completely empty measure stays blank.
 */
export function measureRests(events: ScoreEvent[], total: number): RestSeg[] {
  const notes = events
    .filter((e) => e.kind === 'note')
    .slice()
    .sort((a, b) => a.startTick - b.startTick);
  if (notes.length === 0) return [];

  const segs: RestSeg[] = [];
  let pos = 0;
  for (const n of notes) {
    if (n.startTick > pos) segs.push(...fillGap(pos, n.startTick - pos));
    pos = Math.max(pos, n.startTick + durationTicks(n.duration));
  }
  if (pos < total) segs.push(...fillGap(pos, total - pos));
  return segs;
}
