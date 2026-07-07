export type StepName = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

/** Accidental offset in semitones: double-flat .. double-sharp. */
export type Alter = -2 | -1 | 0 | 1 | 2;

/**
 * Id of the staff an event belongs to. The default grand staff uses 'treble'
 * and 'bass'; additional staves get generated ids ('s3', 's4', …).
 */
export type Staff = string;

export type Clef = 'treble' | 'bass' | 'percussion';

/** One staff of the score: its clef, an optional key override and grouping. */
export interface StaffDef {
  id: Staff;
  clef: Clef;
  key: number | null; // per-staff key signature (transposing instruments); null = follow the score
  hidden?: boolean; // not drawn (it still plays; volume 0 in the mixer mutes it)
  group?: string; // staves sharing a group form a grand staff (brace + shared vertical axis)
  name?: string; // label shown in the mixer
}

/**
 * A pitch in scientific notation (C4 = middle C). `alter` is the accidental.
 * On a percussion staff `drum` names the drum voice (kick, snare, hi-hat, …);
 * the step/octave then only fix the notehead's staff position (see drums.ts).
 */
export interface Pitch {
  step: StepName;
  octave: number;
  alter: Alter; // bb / b / natural / # / x
  explicit?: boolean; // true if the user wrote an accidental on this note
  drum?: string; // drum voice id (percussion staff); overrides pitch for sound + notehead
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
  tieToNext?: boolean; // tie of value: sustain into the next note of the same pitch
  arpeggio?: boolean; // rolled chord: pitches attack bottom-up, all sustaining to the end.
  // Flagged events at the same tick (even across staves) roll together as one chord.
  staccato?: boolean; // dot on the notehead side: sounds a fraction of the written duration
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

/** A chord name written below the staves (free text, eighth-note grid). */
export interface ChordSymbol {
  tick: number; // offset from the measure's start
  text: string;
}

export interface Measure {
  id: string;
  events: ScoreEvent[];
  chords?: ChordSymbol[]; // chord names shown under the grand staff, sorted by tick
  timeSignature?: TimeSignature; // override that starts here and lasts until the next override
  keySignature?: number; // key-signature override that starts here and lasts until the next override
  pickup?: boolean; // anacrusis: an incomplete initial measure whose length follows its content
  repeatStart?: { times: number }; // |: at the measure start; times = total plays of the section (0 = loop forever, 1 = hidden default)
  repeatEnd?: boolean; // :| at the measure end
}

export interface TimeSignature {
  numerator: number;
  denominator: number; // 2, 4, 8, 16 ...
}

export interface ScoreState {
  timeSignature: TimeSignature;
  keySignature: number; // + = sharps, − = flats (−7..7)
  staves?: StaffDef[]; // top-to-bottom; missing = the classic grand staff (see scoreStaves)
  measures: Measure[];
}
