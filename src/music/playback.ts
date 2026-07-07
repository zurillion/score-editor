// Per-piece playback configuration: a general instrument plus per-staff
// overrides (instrument, volume, transpose). Saved inside the piece JSON.
//
// Resolution: a staff plays its own instrument when set, otherwise the general
// one; '' (shown as "—") means "no choice". A general '' in a loaded file
// keeps whatever instrument is currently selected. The staff list is a map so
// more staves can join later without changing the format.
import { Staff } from './types';
import { DEFAULT_INSTRUMENT_ID, INSTRUMENTS } from './instruments';

export interface StaffPlayback {
  instrument: string; // '' = use the general instrument
  volume: number; // 0..100
  transpose: number; // semitones (added to the general transpose)
}

export interface PiecePlayback {
  instrument: string; // general instrument; '' = "—" (no choice)
  transpose: number; // general semitones, added to every staff's own
  staves: Record<string, StaffPlayback>;
}

/** The staves a piece has today (the format is ready for more). */
export const STAFF_IDS: Staff[] = ['treble', 'bass'];
export const STAFF_LABELS: Record<string, string> = { treble: 'Rigo di violino', bass: 'Rigo di basso' };

export const defaultStaffPlayback = (): StaffPlayback => ({ instrument: '', volume: 100, transpose: 0 });

export function defaultPlayback(instrument: string = DEFAULT_INSTRUMENT_ID): PiecePlayback {
  return {
    instrument,
    transpose: 0,
    staves: Object.fromEntries(STAFF_IDS.map((s) => [s, defaultStaffPlayback()])),
  };
}

/** Instrument that actually sounds on a staff: specific wins over general. */
export function effectiveInstrumentId(pb: PiecePlayback, staff: string): string {
  return pb.staves[staff]?.instrument || pb.instrument || DEFAULT_INSTRUMENT_ID;
}

export function staffGain(pb: PiecePlayback, staff: string): number {
  const v = pb.staves[staff]?.volume;
  return (typeof v === 'number' ? Math.min(100, Math.max(0, v)) : 100) / 100;
}

export function staffTranspose(pb: PiecePlayback, staff: string): number {
  return (pb.transpose || 0) + (pb.staves[staff]?.transpose || 0);
}

const clampTranspose = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(48, Math.max(-48, Math.round(v))) : 0);
const validInstrument = (id: unknown): id is string => id === '' || (typeof id === 'string' && INSTRUMENTS.some((i) => i.id === id));

/** Reads a playback block from a loaded file, tolerating anything malformed. */
export function sanitizePlayback(raw: unknown): PiecePlayback | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { instrument?: unknown; transpose?: unknown; staves?: Record<string, { instrument?: unknown; volume?: unknown; transpose?: unknown }> };
  const pb = defaultPlayback('');
  pb.instrument = validInstrument(r.instrument) ? r.instrument : '';
  pb.transpose = clampTranspose(r.transpose);
  if (r.staves && typeof r.staves === 'object') {
    for (const s of STAFF_IDS) {
      const st = r.staves[s];
      if (!st || typeof st !== 'object') continue;
      pb.staves[s] = {
        instrument: validInstrument(st.instrument) ? st.instrument : '',
        volume: typeof st.volume === 'number' && Number.isFinite(st.volume) ? Math.min(100, Math.max(0, Math.round(st.volume))) : 100,
        transpose: clampTranspose(st.transpose),
      };
    }
  }
  return pb;
}

/** True when nothing deviates from the defaults (can be omitted on save). */
export function isNeutralPlayback(pb: PiecePlayback): boolean {
  return (
    !pb.instrument &&
    !pb.transpose &&
    STAFF_IDS.every((s) => {
      const st = pb.staves[s];
      return !st || (!st.instrument && st.volume === 100 && !st.transpose);
    })
  );
}
