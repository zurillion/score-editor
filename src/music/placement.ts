import { Duration, Pitch, ScoreEvent, Staff } from './types';
import { durationTicks, pitchEquals } from './theory';

export type PlaceAction = 'create' | 'chord' | 'delete' | 'blocked';

export function overlaps(events: ScoreEvent[], start: number, dur: number, ignoreId?: string): boolean {
  return events.some(
    (e) => e.id !== ignoreId && start < e.startTick + durationTicks(e.duration) && e.startTick < start + dur,
  );
}

/** What would clicking with the note tool do at this slot/pitch on the given staff? */
export function classifyNote(
  events: ScoreEvent[],
  tick: number,
  pitch: Pitch,
  duration: Duration,
  total: number,
  staff: Staff,
): PlaceAction {
  const staffEvents = events.filter((e) => e.staff === staff);
  const exact = staffEvents.find((e) => e.startTick === tick);
  if (exact) {
    if (exact.kind !== 'note') return 'blocked';
    return exact.pitches.some((p) => pitchEquals(p, pitch)) ? 'delete' : 'chord';
  }
  const dur = durationTicks(duration);
  if (tick + dur > total) return 'blocked';
  return overlaps(staffEvents, tick, dur) ? 'blocked' : 'create';
}

/** What would clicking with the rest tool do at this slot on the given staff? */
export function classifyRest(
  events: ScoreEvent[],
  tick: number,
  duration: Duration,
  total: number,
  staff: Staff,
): PlaceAction {
  const staffEvents = events.filter((e) => e.staff === staff);
  const exact = staffEvents.find((e) => e.startTick === tick);
  if (exact) return exact.kind === 'rest' ? 'delete' : 'blocked';
  const dur = durationTicks(duration);
  if (tick + dur > total) return 'blocked';
  return overlaps(staffEvents, tick, dur) ? 'blocked' : 'create';
}
