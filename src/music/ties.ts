import { NoteEvent, ScoreState, Staff } from './types';
import { eventTicks, pitchToDiatonic } from './theory';
import { ScoreMeta } from './meta';

/** One resolved tie of value, per pitch: a horizontal arc from one note to the next of the same pitch. */
export interface TieConn {
  staff: Staff;
  diatonic: number; // staff position of the tied pitch (ties are horizontal, so same at both ends)
  fromIndex: number; // measure index of the start note
  fromTick: number; // local start tick of the start note
  toIndex: number; // measure index of the end note
  toTick: number; // local start tick of the end note
}

/** The note on `staff` that begins exactly at global tick `g` (the contiguous successor), or null. */
function noteAtGlobal(score: ScoreState, meta: ScoreMeta, staff: Staff, g: number): { index: number; event: NoteEvent } | null {
  for (const mm of meta.measures) {
    if (mm.startTick > g) break;
    if (mm.startTick + mm.total <= g) continue;
    const local = g - mm.startTick;
    for (const ev of score.measures[mm.index].events) {
      if (ev.kind === 'note' && ev.staff === staff && ev.startTick === local) return { index: mm.index, event: ev };
    }
  }
  return null;
}

/**
 * Resolves every valid tie of value in the score: a note flagged `tieToNext`
 * produces a tie for each of its pitches that also appears in the immediately
 * following (contiguous) note on the same staff — within a bar or across bars.
 */
export function resolveTies(score: ScoreState, meta: ScoreMeta): TieConn[] {
  const out: TieConn[] = [];
  for (const mm of meta.measures) {
    for (const ev of score.measures[mm.index].events) {
      if (ev.kind !== 'note' || !ev.tieToNext) continue;
      const endG = mm.startTick + ev.startTick + eventTicks(ev);
      const next = noteAtGlobal(score, meta, ev.staff, endG);
      if (!next) continue;
      for (const p of ev.pitches) {
        if (next.event.pitches.some((q) => q.step === p.step && q.octave === p.octave)) {
          out.push({ staff: ev.staff, diatonic: pitchToDiatonic(p), fromIndex: mm.index, fromTick: ev.startTick, toIndex: next.index, toTick: next.event.startTick });
        }
      }
    }
  }
  return out;
}
