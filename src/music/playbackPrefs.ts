// Adjustable playback parameters (set from the options dialog, read by the
// audio/MIDI schedulers). The UI owns persistence; this module just holds the
// live values so the players see changes without prop-drilling.

export const DEFAULT_ARPEGGIO_MS = 50; // delay between successive notes of a rolled chord
export const DEFAULT_STACCATO_PCT = 50; // % of the written duration a staccato note sounds

let arpeggioStepSec = DEFAULT_ARPEGGIO_MS / 1000;
let staccatoFraction = DEFAULT_STACCATO_PCT / 100;

export const getArpeggioStepSec = (): number => arpeggioStepSec;
export function setArpeggioStepMs(ms: number): void {
  arpeggioStepSec = Math.max(0, ms) / 1000;
}

export const getStaccatoFraction = (): number => staccatoFraction;
export function setStaccatoPct(pct: number): void {
  staccatoFraction = Math.min(100, Math.max(5, pct)) / 100;
}
