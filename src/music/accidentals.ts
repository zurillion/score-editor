import { Alter, ScoreEvent, Staff } from './types';
import { keyAlterForStep } from './key';

export interface Resolved {
  alter: Alter; // the alteration the note actually sounds / is read with
  show: boolean; // whether to draw an accidental glyph
}

const STAVES: Staff[] = ['treble', 'bass'];

/**
 * Resolves accidentals within a measure following the rule "an accidental lasts
 * for the rest of the measure" (per staff, per step+octave), on top of the key
 * signature. Returns a map keyed by `${eventId}|${step}${octave}`.
 *
 * A note with an explicit accidental sets the running alteration for its pitch
 * (and shows a glyph only when it changes it); a note without one sounds the
 * running alteration (key signature until something overrides it).
 */
export function resolveMeasure(events: ScoreEvent[], keySig: number): Map<string, Resolved> {
  const out = new Map<string, Resolved>();
  for (const staff of STAVES) {
    const ctx = new Map<string, Alter>(); // `${step}${octave}` -> current alteration
    const notes = events
      .filter((e) => e.kind === 'note' && e.staff === staff)
      .slice()
      .sort((a, b) => a.startTick - b.startTick);
    for (const ev of notes) {
      if (ev.kind !== 'note') continue;
      for (const p of ev.pitches) {
        const so = `${p.step}${p.octave}`;
        const ctxAlter = ctx.has(so) ? (ctx.get(so) as Alter) : keyAlterForStep(p.step, keySig);
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
