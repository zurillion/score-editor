import { Duration, Pitch, ScoreEvent } from './types';
import { durationTicks, pitchEquals } from './theory';

export type PlaceAction = 'create' | 'chord' | 'delete' | 'blocked';

export function overlaps(events: ScoreEvent[], start: number, dur: number, ignoreId?: string): boolean {
  return events.some(
    (e) => e.id !== ignoreId && start < e.startTick + durationTicks(e.duration) && e.startTick < start + dur,
  );
}

/** What would clicking with the note tool do at this slot/pitch? */
export function classifyNote(
  events: ScoreEvent[],
  tick: number,
  pitch: Pitch,
  duration: Duration,
  total: number,
): PlaceAction {
  const exact = events.find((e) => e.startTick === tick);
  if (exact) {
    if (exact.kind !== 'note') return 'blocked';
    return exact.pitches.some((p) => pitchEquals(p, pitch)) ? 'delete' : 'chord';
  }
  const dur = durationTicks(duration);
  if (tick + dur > total) return 'blocked';
  return overlaps(events, tick, dur) ? 'blocked' : 'create';
}
