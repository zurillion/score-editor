import { Duration, Measure, Pitch, Staff, Tuplet } from '../music/types';

/** Current selection (global measure indices, or global event ids). */
export type Selection =
  | { kind: 'measures'; indices: number[] }
  | { kind: 'notes'; ids: string[] };

/** A copied note, with its tick offset from the earliest copied note (so the
 *  original spacing across measures is preserved on paste). */
export interface ClipNote {
  offset: number;
  staff: Staff;
  duration: Duration;
  pitches: Pitch[];
  tuplet?: Tuplet;
  tieToNext?: boolean;
  staccato?: boolean;
  arpeggio?: boolean;
}

/** What a copy/cut put aside. */
export type Clipboard =
  | { kind: 'measures'; measures: Measure[] }
  | { kind: 'notes'; events: ClipNote[] };
