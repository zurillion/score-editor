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

/** A chord symbol inside the copied span, with its tick offset from the
 *  earliest copied note (pasted alongside the notes, on the same staff line). */
export interface ClipChord {
  offset: number;
  text: string;
  staff: Staff; // the staff whose chord line it sits under
}

/** A free-text line inside the copied span (same offset semantics). */
export interface ClipText {
  offset: number;
  text: string;
  staff: Staff;
  above?: boolean;
}

/** What a copy/cut put aside. */
export type Clipboard =
  | { kind: 'measures'; measures: Measure[] }
  | { kind: 'notes'; events: ClipNote[]; chords?: ClipChord[]; texts?: ClipText[] };
