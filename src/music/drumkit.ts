// Two drum kits for Web Audio playback, selectable per staff:
//   'synth'    — oscillators + filtered noise, fully offline (no downloads);
//   'acoustic' — sampled one-shots of a real acoustic kit, fetched lazily.
//
// `triggerDrum` schedules one hit; pass the loaded acoustic buffers to play the
// sampled kit (voices without a sample fall back to the synth). The voice ids
// match src/music/drums.ts.

import { getDecodeCtx } from './instruments';

// ---- Acoustic sampled kit (lazy) ------------------------------------------
// One-shot samples from the Tone.js hosted acoustic kit (CC, same origin used
// for the piano). AudioBuffers are context-independent, so we decode once and
// reuse them across the per-playback contexts. Voices without a dedicated
// sample map to the closest available one; the rest fall back to the synth.
export type DrumBuffers = Map<string, AudioBuffer>;

const ACOUSTIC_BASE = 'https://tonejs.github.io/audio/drum-samples/acoustic-kit/';
const ACOUSTIC_FILES: Record<string, string> = { kick: 'kick.mp3', snare: 'snare.mp3', hh: 'hh.mp3', hho: 'hho.mp3', tom1: 'tom1.mp3', tom2: 'tom2.mp3', tom3: 'tom3.mp3' };
// drum voice id -> sample file key above
const ACOUSTIC_VOICE: Record<string, string> = {
  kick: 'kick',
  snare: 'snare',
  rim: 'snare', // no dedicated rim sample in this kit
  hihat: 'hh',
  'hihat-pedal': 'hh',
  'hihat-open': 'hho',
  'tom-hi': 'tom1',
  'tom-mid': 'tom2',
  'tom-low': 'tom3',
  // crash / ride have no acoustic sample here: they fall back to the synth
};

let acousticBuffers: DrumBuffers | null = null;
let acousticPending: Promise<DrumBuffers> | null = null;

export function getLoadedAcousticKit(): DrumBuffers | null {
  return acousticBuffers;
}

/** Lazily fetch + decode the acoustic kit; concurrent calls share one promise. */
export function ensureAcousticKit(): Promise<DrumBuffers> {
  if (acousticBuffers) return Promise.resolve(acousticBuffers);
  if (acousticPending) return acousticPending;
  acousticPending = Promise.all(
    Object.entries(ACOUSTIC_FILES).map(async ([key, file]) => {
      const res = await fetch(ACOUSTIC_BASE + file);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${file}`);
      return [key, await getDecodeCtx().decodeAudioData(await res.arrayBuffer())] as const;
    }),
  )
    .then((entries) => {
      const byFile = new Map(entries);
      const map: DrumBuffers = new Map();
      for (const [voiceId, fileKey] of Object.entries(ACOUSTIC_VOICE)) {
        const buf = byFile.get(fileKey);
        if (buf) map.set(voiceId, buf);
      }
      acousticBuffers = map;
      acousticPending = null;
      return map;
    })
    .catch((err) => {
      acousticPending = null;
      throw err;
    });
  return acousticPending;
}

function playBuffer(ctx: BaseAudioContext, dest: AudioNode, buffer: AudioBuffer, start: number, level: number): AudioScheduledSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  g.gain.value = Math.max(0, level);
  src.connect(g).connect(dest);
  src.start(start);
  src.stop(start + buffer.duration + 0.02);
  return src;
}

// ---- Synthesized kit -------------------------------------------------------

// A shared white-noise buffer per audio context (noise is the basis of snare,
// hi-hat and cymbals).
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.2), ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 22222; // deterministic pseudo-noise (Math.random is unavailable in some contexts)
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x40000000) - 1;
    }
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

function noiseSource(ctx: BaseAudioContext): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  return src;
}

/** A pitched body with an exponential pitch drop (kick / toms). */
function tone(ctx: BaseAudioContext, dest: AudioNode, start: number, f0: number, f1: number, dur: number, peak: number): AudioScheduledSourceNode {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(f0, start);
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, f1), start + dur * 0.9);
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(dest);
  osc.start(start);
  osc.stop(start + dur + 0.02);
  return osc;
}

/** A filtered-noise burst (snare / hi-hat / cymbals). */
function noise(ctx: BaseAudioContext, dest: AudioNode, start: number, type: BiquadFilterType, freq: number, dur: number, peak: number, q = 0.7): AudioScheduledSourceNode {
  const src = noiseSource(ctx);
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = freq;
  filt.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(filt).connect(g).connect(dest);
  src.start(start);
  src.stop(start + dur + 0.02);
  return src;
}

/**
 * Schedule one drum hit of `voiceId` at `start` (seconds, ctx time) on `dest`,
 * scaled by `level` (0..1 mixer gain). With `kit` (acoustic buffers) a sampled
 * one-shot plays when the voice has one; otherwise the synth is used. Returns
 * the started source nodes so the caller can track/stop them.
 */
export function triggerDrum(ctx: BaseAudioContext, dest: AudioNode, voiceId: string, start: number, level = 1, kit?: DrumBuffers | null): AudioScheduledSourceNode[] {
  const L = Math.max(0, level);
  const sampled = kit?.get(voiceId);
  if (sampled) return [playBuffer(ctx, dest, sampled, start, 0.9 * L)];
  const out: AudioScheduledSourceNode[] = [];
  const push = (n: AudioScheduledSourceNode | null) => n && out.push(n);
  switch (voiceId) {
    case 'kick':
      push(tone(ctx, dest, start, 150, 50, 0.28, 1.0 * L));
      break;
    case 'snare':
      push(tone(ctx, dest, start, 190, 120, 0.13, 0.35 * L));
      push(noise(ctx, dest, start, 'highpass', 1800, 0.2, 0.7 * L));
      break;
    case 'rim': // rim shot: a bright click plus a short snare body
      push(noise(ctx, dest, start, 'highpass', 3000, 0.05, 0.9 * L, 1.2));
      push(tone(ctx, dest, start, 400, 260, 0.06, 0.4 * L));
      break;
    case 'hihat':
      push(noise(ctx, dest, start, 'highpass', 8000, 0.05, 0.5 * L, 1.0));
      break;
    case 'hihat-pedal':
      push(noise(ctx, dest, start, 'highpass', 7000, 0.06, 0.45 * L, 1.0));
      break;
    case 'hihat-open':
      push(noise(ctx, dest, start, 'highpass', 8000, 0.35, 0.45 * L, 1.0));
      break;
    case 'crash':
      push(noise(ctx, dest, start, 'highpass', 5000, 1.0, 0.5 * L, 0.6));
      break;
    case 'ride':
      push(noise(ctx, dest, start, 'highpass', 6000, 0.5, 0.35 * L, 0.8));
      push(tone(ctx, dest, start, 520, 480, 0.4, 0.14 * L));
      break;
    case 'tom-hi':
      push(tone(ctx, dest, start, 260, 150, 0.28, 0.8 * L));
      break;
    case 'tom-mid':
      push(tone(ctx, dest, start, 200, 110, 0.32, 0.8 * L));
      break;
    case 'tom-low':
      push(tone(ctx, dest, start, 150, 80, 0.36, 0.8 * L));
      break;
    default:
      push(noise(ctx, dest, start, 'highpass', 4000, 0.1, 0.4 * L));
  }
  return out;
}
