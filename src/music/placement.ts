import { Duration, Pitch, ScoreEvent, Staff } from './types';
import { durationTicks, eventTicks, pitchEquals } from './theory';

/** Same notehead? Drum voices are compared by voice id, pitches by step+octave. */
export function samePitch(a: Pitch, b: Pitch): boolean {
  if (a.drum || b.drum) return a.drum === b.drum;
  return pitchEquals(a, b);
}

// 'resize' also covers turning a rest into a note of the chosen value.
export type PlaceAction = 'create' | 'chord' | 'delete' | 'resize' | 'blocked';

export function overlaps(events: ScoreEvent[], start: number, dur: number, ignoreId?: string): boolean {
  return events.some(
    (e) => e.id !== ignoreId && start < e.startTick + eventTicks(e) && e.startTick < start + dur,
  );
}

/**
 * A new span [tick, tick+dur) fits: within the bar and clear of other same-staff
 * *notes*. Rests don't block — a growing/placed note eats the rest span it covers.
 */
function fits(staffEvents: ScoreEvent[], tick: number, dur: number, total: number, ignoreId: string): boolean {
  if (tick + dur > total) return false;
  return !staffEvents.some((e) => e.id !== ignoreId && e.kind === 'note' && tick < e.startTick + eventTicks(e) && e.startTick < tick + dur);
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
  const newDur = durationTicks(duration);
  if (exact) {
    if (exact.kind !== 'note') {
      if (exact.tuplet) return 'create'; // a tuplet rest turns straight back into a note (keeps the slot)
      // a manual rest becomes a note of the chosen value if it fits to the right
      return fits(staffEvents, tick, newDur, total, exact.id) ? 'resize' : 'blocked';
    }
    const isSame = exact.pitches.some((p) => samePitch(p, pitch));
    if (!isSame) return 'chord'; // a new pitch/voice here joins the chord (keeps the value)
    // same pitch: same value removes it; a different value changes the note's value
    if (exact.tuplet || newDur === eventTicks(exact)) return 'delete';
    return fits(staffEvents, tick, newDur, total, exact.id) ? 'resize' : 'blocked';
  }
  // empty slot (possibly inside a rest, which gets eaten): a note blocks, a rest doesn't
  return fits(staffEvents, tick, newDur, total, '') ? 'create' : 'blocked';
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
