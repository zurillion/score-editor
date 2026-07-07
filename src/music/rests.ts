import { Duration, DurationValue, ScoreEvent, Staff } from './types';
import { durationTicks, eventTicks } from './theory';

export interface RestSeg {
  staff: Staff;
  startTick: number;
  duration: Duration;
  whole?: boolean; // a whole-measure rest, centred horizontally
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

/**
 * Fill a gap [start, start+len) with standard rests, metrically aligned: each
 * rest is the largest that fits AND starts on a multiple of its own length.
 * After a short note this naturally builds short-to-long (32nd, 16th, 8th, …)
 * up to the beat instead of dumping the longest rest first.
 */
function fillGap(staff: Staff, start: number, len: number): RestSeg[] {
  const out: RestSeg[] = [];
  let pos = start;
  let rem = len;
  let guard = 0;
  while (rem > 0 && guard++ < 64) {
    const c =
      CANDIDATES.find((cand) => cand.ticks <= rem && pos % cand.ticks === 0) ??
      CANDIDATES.find((cand) => cand.ticks <= rem); // off-grid positions (tuplets): just fit
    if (!c) break;
    out.push({ staff, startTick: pos, duration: { value: c.value, dots: c.dots } });
    pos += c.ticks;
    rem -= c.ticks;
  }
  return out;
}

/**
 * Rests are derived per staff. A staff with events gets its gaps filled; an
 * empty staff gets a single whole-measure rest, but only when *another* staff
 * has at least one note (so a fully empty measure stays blank).
 */
export function measureRests(events: ScoreEvent[], total: number, allowWhole = true, staves: Staff[] = ['treble', 'bass']): RestSeg[] {
  const out: RestSeg[] = [];
  for (const staff of staves) {
    const se = events.filter((e) => e.staff === staff).slice().sort((a, b) => a.startTick - b.startTick);
    if (se.length > 0) {
      let pos = 0;
      for (const e of se) {
        if (e.startTick > pos) out.push(...fillGap(staff, pos, e.startTick - pos));
        pos = Math.max(pos, e.startTick + eventTicks(e));
      }
      if (pos < total) out.push(...fillGap(staff, pos, total - pos));
    } else if (events.some((e) => e.staff !== staff && e.kind === 'note')) {
      // the other staff has notes: this one needs filler rests
      if (allowWhole) out.push({ staff, startTick: 0, duration: { value: 1, dots: 0 }, whole: true });
      else if (total > 0) out.push(...fillGap(staff, 0, total)); // anacrusis: no whole-bar rest
    }
  }
  return out;
}
