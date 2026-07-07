// Drum-kit voices for a percussion staff.
//
// A percussion staff reuses the note model: each drum note is a normal note
// whose pitch carries a `drum` voice id. The voice fixes three things — the
// notehead's staff position (a diatonic, in the treble-staff geometry the
// percussion clef borrows), the notehead shape, and the sound (a synthesized
// General-MIDI drum plus the GM note number for external MIDI on channel 10).
//
// Layout follows the common treble-position drum convention (top → bottom):
// cymbals above the staff, toms descending, snare in the middle, kick at the
// bottom, hi-hat pedal below. Voices that share a staff position (snare / rim
// shot, closed / open hi-hat) are told apart by their id and notehead.

export type DrumHead = 'normal' | 'x' | 'circle-x';

export interface DrumVoice {
  id: string;
  label: string; // Italian, matching the UI
  diatonic: number; // staff position (treble geometry: E4=30 … F5=38, above/below beyond)
  head: DrumHead;
  open?: boolean; // draw a small "o" above (open hi-hat)
  gm: number; // General-MIDI percussion note (channel 10)
}

// Ordered top-to-bottom (how they read on the staff / list in the palette).
export const DRUM_VOICES: DrumVoice[] = [
  { id: 'crash', label: 'Crash', diatonic: 41, head: 'x', gm: 49 },
  { id: 'hihat', label: 'Hi-hat (chiuso)', diatonic: 39, head: 'x', gm: 42 },
  { id: 'hihat-open', label: 'Hi-hat (aperto)', diatonic: 39, head: 'x', open: true, gm: 46 },
  { id: 'ride', label: 'Ride', diatonic: 38, head: 'x', gm: 51 },
  { id: 'tom-hi', label: 'Tom alto', diatonic: 37, head: 'normal', gm: 48 },
  { id: 'tom-mid', label: 'Tom medio', diatonic: 36, head: 'normal', gm: 45 },
  { id: 'snare', label: 'Rullante', diatonic: 35, head: 'normal', gm: 38 },
  { id: 'rim', label: 'Rim shot', diatonic: 35, head: 'circle-x', gm: 37 },
  { id: 'tom-low', label: 'Tom basso', diatonic: 33, head: 'normal', gm: 41 },
  { id: 'kick', label: 'Grancassa', diatonic: 31, head: 'normal', gm: 36 },
  { id: 'hihat-pedal', label: 'Hi-hat (pedale)', diatonic: 29, head: 'x', gm: 44 },
];

const BY_ID = new Map(DRUM_VOICES.map((v) => [v.id, v]));

/** The voice a note plays, or null if the pitch carries no (valid) drum id. */
export function drumVoice(id: string | undefined): DrumVoice | null {
  return id ? BY_ID.get(id) ?? null : null;
}

/** Default voice for a fresh percussion note. */
export const DEFAULT_DRUM_ID = 'snare';

/** Voice whose staff position is nearest to a diatonic (for click placement). */
export function drumVoiceNearest(diatonic: number): DrumVoice {
  let best = DRUM_VOICES[0];
  for (const v of DRUM_VOICES) if (Math.abs(v.diatonic - diatonic) < Math.abs(best.diatonic - diatonic)) best = v;
  return best;
}
