// Sampled instruments for playback (same sample sets used by Harmonium):
// Salamander Grand Piano via tonejs.github.io and nbrosowsky/tonejs-instruments,
// all CC-BY 3.0. Samples are fetched lazily the first time an instrument is
// used and pitch-shifted to the nearest sampled note via playbackRate.

/** The built-in oscillator synth (the original app sound). */
export const SYNTH_ID = '8bit';
export const DEFAULT_INSTRUMENT_ID = 'piano';

export interface InstrumentDef {
  id: string;
  /** UI label (Italian, matching the rest of the interface). */
  name: string;
  /** Sample set; absent for the built-in synth. */
  samples?: { baseUrl: string; urls: Record<string, string> };
}

const NBROSOWSKY = 'https://raw.githubusercontent.com/nbrosowsky/tonejs-instruments/master/samples';

export const INSTRUMENTS: InstrumentDef[] = [
  {
    id: 'piano',
    name: 'Pianoforte a coda',
    samples: {
      baseUrl: 'https://tonejs.github.io/audio/salamander/',
      urls: { C4: 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3', A4: 'A4.mp3', C5: 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3', A5: 'A5.mp3' },
    },
  },
  {
    id: 'harp',
    name: 'Arpa',
    samples: {
      baseUrl: `${NBROSOWSKY}/harp/`,
      urls: { E1: 'E1.mp3', D2: 'D2.mp3', C3: 'C3.mp3', B3: 'B3.mp3', C5: 'C5.mp3', B5: 'B5.mp3', A6: 'A6.mp3', F7: 'F7.mp3' },
    },
  },
  {
    id: 'harmonium',
    name: 'Armonium',
    samples: {
      baseUrl: `${NBROSOWSKY}/harmonium/`,
      urls: { C2: 'C2.mp3', F2: 'F2.mp3', 'A#2': 'As2.mp3', E3: 'E3.mp3', 'G#3': 'Gs3.mp3', D4: 'D4.mp3', 'G#4': 'Gs4.mp3', D5: 'D5.mp3' },
    },
  },
  {
    id: 'bass-electric',
    name: 'Basso elettrico',
    samples: {
      baseUrl: `${NBROSOWSKY}/bass-electric/`,
      urls: { 'C#1': 'Cs1.mp3', G1: 'G1.mp3', 'C#2': 'Cs2.mp3', G2: 'G2.mp3', E3: 'E3.mp3', 'A#3': 'As3.mp3', E4: 'E4.mp3', 'A#4': 'As4.mp3' },
    },
  },
  {
    id: 'guitar-acoustic',
    name: 'Chitarra acustica',
    samples: {
      baseUrl: `${NBROSOWSKY}/guitar-acoustic/`,
      urls: { D2: 'D2.mp3', G2: 'G2.mp3', C3: 'C3.mp3', F3: 'F3.mp3', B3: 'B3.mp3', E4: 'E4.mp3', A4: 'A4.mp3', D5: 'D5.mp3' },
    },
  },
  {
    id: 'guitar-nylon',
    name: 'Chitarra classica',
    samples: {
      baseUrl: `${NBROSOWSKY}/guitar-nylon/`,
      urls: { B1: 'B1.mp3', 'G#2': 'Gs2.mp3', D3: 'D3.mp3', A3: 'A3.mp3', E4: 'E4.mp3', B4: 'B4.mp3', 'F#5': 'Fs5.mp3', 'A#5': 'As5.mp3' },
    },
  },
  {
    id: 'guitar-electric',
    name: 'Chitarra elettrica',
    samples: {
      baseUrl: `${NBROSOWSKY}/guitar-electric/`,
      urls: { A2: 'A2.mp3', C4: 'C4.mp3', 'F#4': 'Fs4.mp3' },
    },
  },
  {
    id: 'clarinet',
    name: 'Clarinetto',
    samples: {
      baseUrl: `${NBROSOWSKY}/clarinet/`,
      urls: { D3: 'D3.mp3', F3: 'F3.mp3', D4: 'D4.mp3', F4: 'F4.mp3', D5: 'D5.mp3', F5: 'F5.mp3', D6: 'D6.mp3', 'F#6': 'Fs6.mp3' },
    },
  },
  {
    id: 'contrabass',
    name: 'Contrabbasso',
    samples: {
      baseUrl: `${NBROSOWSKY}/contrabass/`,
      urls: { 'F#1': 'Fs1.mp3', 'A#1': 'As1.mp3', C2: 'C2.mp3', E2: 'E2.mp3', 'G#2': 'Gs2.mp3', 'C#3': 'Cs3.mp3', E3: 'E3.mp3', B3: 'B3.mp3' },
    },
  },
  {
    id: 'french-horn',
    name: 'Corno francese',
    samples: {
      baseUrl: `${NBROSOWSKY}/french-horn/`,
      urls: { A1: 'A1.mp3', C2: 'C2.mp3', G2: 'G2.mp3', D3: 'D3.mp3', F3: 'F3.mp3', A3: 'A3.mp3', D5: 'D5.mp3', F5: 'F5.mp3' },
    },
  },
  {
    id: 'bassoon',
    name: 'Fagotto',
    samples: {
      baseUrl: `${NBROSOWSKY}/bassoon/`,
      urls: { G2: 'G2.mp3', A2: 'A2.mp3', G3: 'G3.mp3', A3: 'A3.mp3', C4: 'C4.mp3', E4: 'E4.mp3', A4: 'A4.mp3', C5: 'C5.mp3' },
    },
  },
  {
    id: 'flute',
    name: 'Flauto',
    samples: {
      baseUrl: `${NBROSOWSKY}/flute/`,
      urls: { C4: 'C4.mp3', C5: 'C5.mp3', A5: 'A5.mp3', C6: 'C6.mp3' },
    },
  },
  {
    id: 'organ',
    name: 'Organo',
    samples: {
      baseUrl: `${NBROSOWSKY}/organ/`,
      urls: { C1: 'C1.mp3', A1: 'A1.mp3', 'F#2': 'Fs2.mp3', 'D#3': 'Ds3.mp3', A3: 'A3.mp3', 'F#4': 'Fs4.mp3', 'D#5': 'Ds5.mp3', C6: 'C6.mp3' },
    },
  },
  {
    id: 'saxophone',
    name: 'Sassofono',
    samples: {
      baseUrl: `${NBROSOWSKY}/saxophone/`,
      urls: { 'C#3': 'Cs3.mp3', F3: 'F3.mp3', B3: 'B3.mp3', 'D#4': 'Ds4.mp3', 'G#4': 'Gs4.mp3', C5: 'C5.mp3', F5: 'F5.mp3', A5: 'A5.mp3' },
    },
  },
  {
    id: 'violin',
    name: 'Archi (violino)',
    samples: {
      baseUrl: `${NBROSOWSKY}/violin/`,
      urls: { A3: 'A3.mp3', C4: 'C4.mp3', A4: 'A4.mp3', A5: 'A5.mp3' },
    },
  },
  {
    id: 'cello',
    name: 'Violoncello',
    samples: {
      baseUrl: `${NBROSOWSKY}/cello/`,
      urls: { C2: 'C2.mp3', G2: 'G2.mp3', B2: 'B2.mp3', E3: 'E3.mp3', A3: 'A3.mp3', D4: 'D4.mp3', 'F#4': 'Fs4.mp3', C5: 'C5.mp3' },
    },
  },
  {
    id: 'trombone',
    name: 'Trombone',
    samples: {
      baseUrl: `${NBROSOWSKY}/trombone/`,
      urls: { 'A#1': 'As1.mp3', 'D#2': 'Ds2.mp3', 'A#2': 'As2.mp3', D3: 'D3.mp3', F3: 'F3.mp3', 'A#3': 'As3.mp3', D4: 'D4.mp3', F4: 'F4.mp3' },
    },
  },
  {
    id: 'trumpet',
    name: 'Tromba',
    samples: {
      baseUrl: `${NBROSOWSKY}/trumpet/`,
      urls: { F3: 'F3.mp3', A3: 'A3.mp3', 'D#4': 'Ds4.mp3', F4: 'F4.mp3', 'A#4': 'As4.mp3', D5: 'D5.mp3', A5: 'A5.mp3', C6: 'C6.mp3' },
    },
  },
  {
    id: 'tuba',
    name: 'Tuba',
    samples: {
      baseUrl: `${NBROSOWSKY}/tuba/`,
      urls: { F1: 'F1.mp3', 'A#1': 'As1.mp3', 'D#2': 'Ds2.mp3', F2: 'F2.mp3', D3: 'D3.mp3', F3: 'F3.mp3', 'A#3': 'As3.mp3', D4: 'D4.mp3' },
    },
  },
  {
    id: 'xylophone',
    name: 'Xilofono',
    samples: {
      baseUrl: `${NBROSOWSKY}/xylophone/`,
      urls: { G4: 'G4.mp3', C5: 'C5.mp3', G5: 'G5.mp3', C6: 'C6.mp3', G6: 'G6.mp3', C7: 'C7.mp3', G7: 'G7.mp3', C8: 'C8.mp3' },
    },
  },
  { id: SYNTH_ID, name: '8 bit sound' },
];

export function getInstrument(id: string): InstrumentDef | undefined {
  return INSTRUMENTS.find((i) => i.id === id);
}

export function isSynth(id: string): boolean {
  const def = getInstrument(id);
  return !def || !def.samples;
}

/** A decoded sample set: one buffer per sampled pitch, sorted by MIDI number. */
export interface Sampler {
  zones: { midi: number; buffer: AudioBuffer }[];
}

/** Zone whose sampled pitch is closest to `midi` (smallest playbackRate shift). */
export function nearestZone(sampler: Sampler, midi: number): Sampler['zones'][number] {
  let best = sampler.zones[0];
  for (const z of sampler.zones) if (Math.abs(z.midi - midi) < Math.abs(best.midi - midi)) best = z;
  return best;
}

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteNameToMidi(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d+)$/.exec(name);
  if (!m) throw new Error(`Invalid note name: ${name}`);
  const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + PITCH_CLASS[m[1]] + alter;
}

// AudioBuffers are context-independent, so we decode once with a shared
// context and reuse the buffers in the per-playback contexts of the Player.
let decodeCtx: AudioContext | null = null;
function getDecodeCtx(): AudioContext {
  if (!decodeCtx) {
    const AudioCtx: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    decodeCtx = new AudioCtx();
  }
  return decodeCtx;
}

const loaded = new Map<string, Sampler>();
const pending = new Map<string, Promise<Sampler>>();

export function getLoadedSampler(id: string): Sampler | null {
  return loaded.get(id) ?? null;
}

/**
 * Lazily fetch and decode an instrument's samples. Concurrent calls for the
 * same instrument share one promise; a failed load is forgotten so a later
 * attempt can retry. Resolves to null for the built-in synth.
 */
export function ensureInstrument(id: string): Promise<Sampler | null> {
  const def = getInstrument(id);
  if (!def?.samples) return Promise.resolve(null);
  const cached = loaded.get(id);
  if (cached) return Promise.resolve(cached);
  const inFlight = pending.get(id);
  if (inFlight) return inFlight;

  const { baseUrl, urls } = def.samples;
  const promise = Promise.all(
    Object.entries(urls).map(async ([note, file]) => {
      const res = await fetch(baseUrl + file);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${file}`);
      const buffer = await getDecodeCtx().decodeAudioData(await res.arrayBuffer());
      return { midi: noteNameToMidi(note), buffer };
    }),
  )
    .then((zones) => {
      const sampler: Sampler = { zones: zones.sort((a, b) => a.midi - b.midi) };
      loaded.set(id, sampler);
      pending.delete(id);
      return sampler;
    })
    .catch((err) => {
      pending.delete(id);
      throw err;
    });
  pending.set(id, promise);
  return promise;
}
