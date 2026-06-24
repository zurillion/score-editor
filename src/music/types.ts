export type StepName = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

/** Accidental offset in semitones: double-flat .. double-sharp. */
export type Alter = -2 | -1 | 0 | 1 | 2;

/** Which staff of the grand staff an event belongs to (kept independent of pitch). */
export type Staff = 'treble' | 'bass';

/** A pitch in scientific notation (C4 = middle C). `alter` is the accidental. */
export interface Pitch {
  step: StepName;
  octave: number;
  alter: Alter; // bb / b / natural / # / x
  explicit?: boolean; // true if the user wrote an accidental on this note
}

export type DurationValue = 1 | 2 | 4 | 8 | 16 | 32; // whole .. 32nd
export interface Duration {
  value: DurationValue;
  dots: 0 | 1 | 2;
}

/**
 * Tuplet membership: `actual` notes played in the time of `normal` (a triplet is
 * 3:2). Events sharing an `id` form one bracketed group and beam together.
 */
export interface Tuplet {
  id: string;
  actual: number; // e.g. 3
  normal: number; // e.g. 2
}

export interface NoteEvent {
  id: string;
  kind: 'note';
  staff: Staff;
  startTick: number; // offset from the measure's start
  duration: Duration;
  pitches: Pitch[]; // one entry = single note, several = chord (simultaneous notes)
  tuplet?: Tuplet; // set on each member of a tuplet group
}

export interface RestEvent {
  id: string;
  kind: 'rest';
  staff: Staff;
  startTick: number;
  duration: Duration;
  tuplet?: Tuplet;
}

export type ScoreEvent = NoteEvent | RestEvent;

export interface Measure {
  id: string;
  events: ScoreEvent[];
  timeSignature?: TimeSignature; // override that starts here and lasts until the next override
  keySignature?: number; // key-signature override that starts here and lasts until the next override
  pickup?: boolean; // anacrusis: an incomplete initial measure whose length follows its content
}

export interface TimeSignature {
  numerator: number;
  denominator: number; // 2, 4, 8, 16 ...
}

export interface ScoreState {
  timeSignature: TimeSignature;
  keySignature: number; // + = sharps, − = flats (−7..7)
  measures: Measure[];
}
