import { Alter, StepName } from './types';

// Order in which sharps / flats are added to a key signature.
const SHARP_ORDER: StepName[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER: StepName[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

// Staff positions (diatonic, C4 = 28) of each accidental in the TREBLE clef.
// The bass clef is exactly two octaves lower (− 14).
const SHARP_POS_TREBLE = [38, 35, 39, 36, 33, 37, 34]; // F C G D A E B
const FLAT_POS_TREBLE = [34, 37, 33, 36, 32, 35, 31]; // B E A D G C F

/** Chromatic alteration the key signature gives a given step (0 if none). */
export function keyAlterForStep(step: StepName, keySig: number): Alter {
  if (keySig > 0) return SHARP_ORDER.slice(0, keySig).includes(step) ? 1 : 0;
  if (keySig < 0) return FLAT_ORDER.slice(0, -keySig).includes(step) ? -1 : 0;
  return 0;
}

export interface KeyAccidental {
  step: StepName;
  diatonic: number;
  alter: 1 | -1;
}

/** The accidentals to draw for a key signature on a staff (treble offset = 0, bass = −14). */
export function keySignatureAccidentals(keySig: number, staffOffset: number): KeyAccidental[] {
  if (keySig > 0) {
    return SHARP_ORDER.slice(0, keySig).map((step, i) => ({ step, diatonic: SHARP_POS_TREBLE[i] + staffOffset, alter: 1 as const }));
  }
  if (keySig < 0) {
    return FLAT_ORDER.slice(0, -keySig).map((step, i) => ({ step, diatonic: FLAT_POS_TREBLE[i] + staffOffset, alter: -1 as const }));
  }
  return [];
}

/**
 * Naturals to draw when changing from `prevKey` to `newKey`: one for each
 * accidental of the OLD key whose step becomes natural in the new key. Steps
 * that stay altered (or merely change accidental) are not cancelled — the new
 * key signature states them. Positions follow the old key's accidental order.
 */
export function keyChangeNaturals(prevKey: number, newKey: number, staffOffset: number): { step: StepName; diatonic: number }[] {
  return keySignatureAccidentals(prevKey, staffOffset)
    .filter((e) => keyAlterForStep(e.step, newKey) === 0)
    .map((e) => ({ step: e.step, diatonic: e.diatonic }));
}

// ---- Friendly key names (Italian), for the toolbar selector ----
// index = count of sharps (+) or flats (−), from −7 to +7.
const MAJOR = ['Do♭', 'Sol♭', 'Re♭', 'La♭', 'Mi♭', 'Si♭', 'Fa', 'Do', 'Sol', 'Re', 'La', 'Mi', 'Si', 'Fa♯', 'Do♯'];
const MINOR = ['La♭', 'Mi♭', 'Si♭', 'Fa', 'Do', 'Sol', 'Re', 'La', 'Mi', 'Si', 'Fa♯', 'Do♯', 'Sol♯', 'Re♯', 'La♯'];

export interface KeyOption {
  value: number;
  label: string;
}

export const KEY_OPTIONS: KeyOption[] = Array.from({ length: 15 }, (_, i) => {
  const count = i - 7; // −7 .. +7
  const acc = count === 0 ? 'naturale' : `${Math.abs(count)}${count > 0 ? '♯' : '♭'}`;
  return { value: count, label: `${acc} — ${MAJOR[i]} magg / ${MINOR[i]} min` };
});
