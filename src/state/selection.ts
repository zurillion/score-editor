import { Measure, NoteEvent } from '../music/types';

/** Current selection (global measure indices, or global event ids). */
export type Selection =
  | { kind: 'measures'; indices: number[] }
  | { kind: 'notes'; ids: string[] };

/** What a copy/cut put aside. Paste is not wired up yet. */
export type Clipboard =
  | { kind: 'measures'; measures: Measure[] }
  | { kind: 'notes'; events: NoteEvent[] };
