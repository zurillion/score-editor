export type StepName = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

/** A pitch in scientific notation (C4 = middle C). `alter` is the accidental. */
export interface Pitch {
  step: StepName;
  octave: number;
  alter: -1 | 0 | 1; // flat / natural / sharp
}

export type DurationValue = 1 | 2 | 4 | 8 | 16 | 32; // whole .. 32nd
export interface Duration {
  value: DurationValue;
  dots: 0 | 1 | 2;
}

export interface NoteEvent {
  id: string;
  kind: 'note';
  startTick: number; // offset from the measure's start
  duration: Duration;
  pitches: Pitch[]; // one entry = single note, several = chord (simultaneous notes)
}

export interface RestEvent {
  id: string;
  kind: 'rest';
  startTick: number;
  duration: Duration;
}

export type ScoreEvent = NoteEvent | RestEvent;

export interface Measure {
  id: string;
  events: ScoreEvent[];
}

export interface TimeSignature {
  numerator: number;
  denominator: number; // 2, 4, 8, 16 ...
}

export interface ScoreState {
  timeSignature: TimeSignature;
  measures: Measure[];
}
