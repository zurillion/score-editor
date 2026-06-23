import { Alter, Duration, Pitch, Staff, StepName, TimeSignature } from './types';
import { TICKS_PER_WHOLE } from './constants';

export const STEP_NAMES: StepName[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const STEP_INDEX: Record<StepName, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const STEP_SEMITONE: Record<StepName, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * "Diatonic position": an integer where each consecutive staff line/space is
 * one step. Middle C (C4) is 28; higher pitch => larger number.
 */
export function pitchToDiatonic(p: Pitch): number {
  return p.octave * 7 + STEP_INDEX[p.step];
}

export function diatonicToPitch(d: number, alter: Alter = 0): Pitch {
  const octave = Math.floor(d / 7);
  const idx = ((d % 7) + 7) % 7;
  return { step: STEP_NAMES[idx], octave, alter };
}

/** Default staff for a diatonic position: middle C (28) and up = treble. */
export function staffForDiatonic(d: number): Staff {
  return d >= 28 ? 'treble' : 'bass';
}

export function pitchToMidi(p: Pitch): number {
  return (p.octave + 1) * 12 + STEP_SEMITONE[p.step] + p.alter;
}

export function pitchToFrequency(p: Pitch): number {
  return 440 * Math.pow(2, (pitchToMidi(p) - 69) / 12);
}

/** Duration in ticks, including augmentation dots. */
export function durationTicks(d: Duration): number {
  const base = TICKS_PER_WHOLE / d.value;
  const dotFactor = d.dots === 0 ? 1 : d.dots === 1 ? 1.5 : 1.75;
  return Math.round(base * dotFactor);
}

export function measureTicks(ts: TimeSignature): number {
  return ts.numerator * (TICKS_PER_WHOLE / ts.denominator);
}

/** Same staff position? Accidental is intentionally ignored (for hit-testing). */
export function pitchEquals(a: Pitch, b: Pitch): boolean {
  return a.step === b.step && a.octave === b.octave;
}

export function pitchName(p: Pitch): string {
  const acc =
    p.alter === 2 ? '𝄪' : p.alter === 1 ? '♯' : p.alter === -1 ? '♭' : p.alter === -2 ? '𝄫' : '';
  return `${p.step}${acc}${p.octave}`;
}

const STEP_NAME_IT: Record<StepName, string> = { C: 'Do', D: 'Re', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };

/** Italian note name with accidental glyph and octave, e.g. "Fa♯4". */
export function pitchNameIt(p: Pitch): string {
  const acc =
    p.alter === 2 ? '𝄪' : p.alter === 1 ? '♯' : p.alter === -1 ? '♭' : p.alter === -2 ? '𝄫' : '';
  return `${STEP_NAME_IT[p.step]}${acc}${p.octave}`;
}

export function durationLabel(d: Duration): string {
  const base: Record<number, string> = {
    1: 'intero',
    2: 'metà',
    4: 'quarto',
    8: 'ottavo',
    16: 'sedicesimo',
    32: 'trentaduesimo',
  };
  const dots = d.dots === 1 ? ' puntato' : d.dots === 2 ? ' doppio punto' : '';
  return base[d.value] + dots;
}
