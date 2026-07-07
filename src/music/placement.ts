import { Duration, Pitch, ScoreEvent, Staff } from './types';
import { durationTicks, eventTicks, pitchEquals } from './theory';

export type PlaceAction = 'create' | 'chord' | 'delete' | 'blocked';

export function overlaps(events: ScoreEvent[], start: number, dur: number, ignoreId?: string): boolean {
  return events.some(
    (e) => e.id !== ignoreId && start < e.startTick + eventTicks(e) && e.startTick < start + dur,
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
    if (exact.kind !== 'note') return exact.tuplet ? 'create' : 'blocked'; // a tuplet rest can be turned back into a note
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
  if (exact) {
    if (exact.kind === 'rest') return 'delete';
    // a note (or chord) of the same written value can be silenced: the rest replaces it
    return !exact.tuplet && durationTicks(exact.duration) === durationTicks(duration) ? 'delete' : 'blocked';
  }
  const dur = durationTicks(duration);
  if (tick + dur > total) return 'blocked';
  return overlaps(staffEvents, tick, dur) ? 'blocked' : 'create';
}
