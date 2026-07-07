import { Alter, ScoreEvent, Staff, StepName } from './types';
import { keyAlterForStep } from './key';

export interface Resolved {
  alter: Alter; // the alteration the note actually sounds / is read with
  show: boolean; // whether to draw an accidental glyph
}

/** Distinct staff ids present in a set of events (stable order of appearance). */
export function staffIdsIn(events: ScoreEvent[]): Staff[] {
  const ids: Staff[] = [];
  for (const e of events) if (!ids.includes(e.staff)) ids.push(e.staff);
  return ids;
}

/**
 * Resolves accidentals within a measure following the rule "an accidental lasts
 * for the rest of the measure" (per staff, per step+octave), on top of the key
 * signature. Returns a map keyed by `${eventId}|${step}${octave}`.
 *
 * A note with an explicit accidental sets the running alteration for its pitch
 * (and shows a glyph only when it changes it); a note without one sounds the
 * running alteration (key signature until something overrides it).
 *
 * `keySig` may be a per-staff resolver so transposing staves read their own key.
 */
export function resolveMeasure(events: ScoreEvent[], keySig: number | ((staff: Staff) => number)): Map<string, Resolved> {
  const out = new Map<string, Resolved>();
  const keyOf = typeof keySig === 'number' ? () => keySig : keySig;
  for (const staff of staffIdsIn(events)) {
    const staffKey = keyOf(staff);
    const ctx = new Map<string, Alter>(); // `${step}${octave}` -> current alteration
    const notes = events
      .filter((e) => e.kind === 'note' && e.staff === staff)
      .slice()
      .sort((a, b) => a.startTick - b.startTick);
    for (const ev of notes) {
      if (ev.kind !== 'note') continue;
      for (const p of ev.pitches) {
        const so = `${p.step}${p.octave}`;
        const ctxAlter = ctx.has(so) ? (ctx.get(so) as Alter) : keyAlterForStep(p.step, staffKey);
        let resolved: Resolved;
        if (p.explicit) {
          resolved = { alter: p.alter, show: p.alter !== ctxAlter };
          ctx.set(so, p.alter);
        } else {
          resolved = { alter: ctxAlter, show: false };
        }
        out.set(`${ev.id}|${so}`, resolved);
      }
    }
  }
  return out;
}

/**
 * The alteration a *new* note of (step, octave) on `staff` would take if placed
 * at `atTick` in this measure: the key-signature default unless an explicit
 * accidental earlier in the measure (same step+octave, same staff) overrides it.
 */
export function effectiveAlterForNew(
  events: ScoreEvent[],
  keySig: number,
  staff: Staff,
  step: StepName,
  octave: number,
  atTick: number,
): Alter {
  let alter: Alter = keyAlterForStep(step, keySig);
  const before = events
    .filter((e) => e.kind === 'note' && e.staff === staff && e.startTick < atTick)
    .slice()
    .sort((a, b) => a.startTick - b.startTick);
  for (const ev of before) {
    if (ev.kind !== 'note') continue;
    for (const p of ev.pitches) {
      if (p.explicit && p.step === step && p.octave === octave) alter = p.alter;
    }
  }
  return alter;
}
