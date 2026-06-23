import { NoteEvent, ScoreEvent, Staff, TimeSignature } from './types';
import { TICKS_PER_QUARTER, TICKS_PER_WHOLE } from './constants';

/** Number of beams a note value carries (eighth = 1, 16th = 2, 32nd = 3; longer = 0). */
export function beamCount(value: number): number {
  return value === 8 ? 1 : value === 16 ? 2 : value === 32 ? 3 : 0;
}

/** Ticks of the beaming beat: a dotted quarter in compound meters, else a quarter. */
export function beamBeatTicks(ts: TimeSignature): number {
  const compound = ts.denominator === 8 && ts.numerator % 3 === 0;
  return compound ? (TICKS_PER_WHOLE / 8) * 3 : TICKS_PER_QUARTER;
}

/**
 * Beam groups for one staff: runs of 2+ consecutive beamable notes that fall in
 * the same beat. A rest or a note that can't be beamed (quarter or longer)
 * breaks the run; single beamable notes keep their flag.
 */
export function beamGroups(events: ScoreEvent[], staff: Staff, ts: TimeSignature): NoteEvent[][] {
  const beat = beamBeatTicks(ts);
  const staffEvents = events.filter((e) => e.staff === staff).slice().sort((a, b) => a.startTick - b.startTick);
  const groups: NoteEvent[][] = [];
  let cur: NoteEvent[] = [];
  let curBeat = -1;
  const flush = () => {
    if (cur.length >= 2) groups.push(cur);
    cur = [];
  };
  for (const e of staffEvents) {
    if (e.kind === 'note' && beamCount(e.duration.value) >= 1) {
      const b = Math.floor(e.startTick / beat);
      if (cur.length === 0 || b === curBeat) {
        if (cur.length === 0) curBeat = b;
        cur.push(e);
      } else {
        flush();
        cur = [e];
        curBeat = b;
      }
    } else {
      flush();
    }
  }
  flush();
  return groups;
}
