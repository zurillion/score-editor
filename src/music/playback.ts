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
  mute?: boolean; // M: the staff is silent
  solo?: boolean; // S: when any staff is soloed, only soloed staves sound
  midiChannel?: number; // 1..16 (MIDI output); absent = the piece's general channel
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

/** True when at least one staff is soloed (then only soloed staves sound). */
export function anySolo(pb: PiecePlayback): boolean {
  return Object.values(pb.staves).some((st) => st?.solo);
}

export function staffGain(pb: PiecePlayback, staff: Staff): number {
  const st = pb.staves[staff];
  if (st?.mute) return 0;
  if (anySolo(pb) && !st?.solo) return 0;
  const v = st?.volume;
  return (typeof v === 'number' ? Math.min(100, Math.max(0, v)) : 100) / 100;
}

export function staffTranspose(pb: PiecePlayback, staff: Staff): number {
  return (pb.transpose || 0) + (pb.staves[staff]?.transpose || 0);
}

/** Per-staff MIDI channel (1..16), or null to use the piece's general one. */
export function staffMidiChannel(pb: PiecePlayback, staff: Staff): number | null {
  const c = pb.staves[staff]?.midiChannel;
  return typeof c === 'number' && c >= 1 && c <= 16 ? c : null;
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
      const entry = st as { mute?: unknown; solo?: unknown; instrument?: unknown; volume?: unknown; transpose?: unknown; midiChannel?: unknown };
      pb.staves[id] = {
        instrument: validInstrument(entry.instrument) ? entry.instrument : '',
        volume: typeof entry.volume === 'number' && Number.isFinite(entry.volume) ? Math.min(100, Math.max(0, Math.round(entry.volume))) : 100,
        transpose: clampTranspose(entry.transpose),
        ...(entry.mute === true ? { mute: true } : {}),
        ...(entry.solo === true ? { solo: true } : {}),
        ...(typeof entry.midiChannel === 'number' && Number.isFinite(entry.midiChannel) && Math.round(entry.midiChannel) >= 1 && Math.round(entry.midiChannel) <= 16
          ? { midiChannel: Math.round(entry.midiChannel) }
          : {}),
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
    Object.values(pb.staves).every((st) => !st || (!st.instrument && st.volume === 100 && !st.transpose && !st.mute && !st.solo && !st.midiChannel))
  );
}
