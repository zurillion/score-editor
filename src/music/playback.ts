// Per-piece playback configuration: a general instrument plus per-staff
// overrides (instrument, volume, transpose). Saved inside the piece JSON.
//
// Resolution: a staff plays its own instrument when set, otherwise the general
// one; '' (shown as "—") means "no choice". A general '' in a loaded file
// keeps whatever instrument is currently selected. The staff map is keyed by
// staff id, so it follows whatever staves the score defines (see staves.ts).
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

export const defaultStaffPlayback = (): StaffPlayback => ({ instrument: '', volume: 100, transpose: 0 });

export function defaultPlayback(instrument: string = DEFAULT_INSTRUMENT_ID): PiecePlayback {
  return { instrument, transpose: 0, staves: {} };
}

/** Instrument that actually sounds on a staff: specific wins over general. */
export function effectiveInstrumentId(pb: PiecePlayback, staff: Staff): string {
  return pb.staves[staff]?.instrument || pb.instrument || DEFAULT_INSTRUMENT_ID;
}

export function staffGain(pb: PiecePlayback, staff: Staff): number {
  const v = pb.staves[staff]?.volume;
  return (typeof v === 'number' ? Math.min(100, Math.max(0, v)) : 100) / 100;
}

export function staffTranspose(pb: PiecePlayback, staff: Staff): number {
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
    for (const [id, st] of Object.entries(r.staves)) {
      if (!st || typeof st !== 'object') continue;
      pb.staves[id] = {
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
    Object.values(pb.staves).every((st) => !st || (!st.instrument && st.volume === 100 && !st.transpose))
  );
}
