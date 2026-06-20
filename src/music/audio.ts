import { Pitch, ScoreState } from './types';
import { durationTicks, measureTicks, pitchToFrequency } from './theory';
import { TICKS_PER_QUARTER } from './constants';

// ---- One-shot audio preview ----
// Used by the "play note on creation" option. Keeps a single shared
// AudioContext alive so we don't spawn one per click.
let previewCtx: AudioContext | null = null;

/** Play the given pitches immediately with a short, fixed-length envelope. */
export function playPreview(pitches: Pitch[], durSec = 0.5): void {
  if (pitches.length === 0) return;
  const AudioCtx: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!previewCtx) previewCtx = new AudioCtx();
  const ctx = previewCtx;
  if (ctx.state === 'suspended') void ctx.resume();

  const t0 = ctx.currentTime + 0.005;
  const end = t0 + durSec;
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);

  for (const p of pitches) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = pitchToFrequency(p);
    const gain = ctx.createGain();
    const attack = 0.006;
    const release = Math.min(0.14, durSec * 0.4);
    const peak = 0.3;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + attack);
    gain.gain.setValueAtTime(peak, Math.max(t0 + attack, end - release));
    gain.gain.linearRampToValueAtTime(0, end);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t0);
    osc.stop(end + 0.03);
  }
}

export interface ScheduledNote {
  startSec: number;
  durSec: number;
  freqs: number[];
}

export interface Schedule {
  notes: ScheduledNote[];
  totalSec: number;
  totalTicks: number;
  secPerTick: number;
}

/** BPM counts quarter notes per minute. */
export function buildSchedule(score: ScoreState, bpm: number): Schedule {
  const secPerQuarter = 60 / bpm;
  const secPerTick = secPerQuarter / TICKS_PER_QUARTER;
  const mTicks = measureTicks(score.timeSignature);
  const notes: ScheduledNote[] = [];
  let measureStart = 0;
  for (const m of score.measures) {
    for (const ev of m.events) {
      if (ev.kind !== 'note') continue;
      const startSec = (measureStart + ev.startTick) * secPerTick;
      const durSec = durationTicks(ev.duration) * secPerTick;
      notes.push({ startSec, durSec, freqs: ev.pitches.map(pitchToFrequency) });
    }
    measureStart += mTicks;
  }
  const totalTicks = measureStart;
  return { notes, totalSec: totalTicks * secPerTick, totalTicks, secPerTick };
}

/**
 * Simple polyphonic Web Audio player. Each note is a short triangle-wave
 * oscillator with an attack/release envelope. A requestAnimationFrame loop
 * reports elapsed playback time so the UI can drive the playhead.
 */
export class Player {
  private ctx: AudioContext | null = null;
  private sources: OscillatorNode[] = [];
  private raf = 0;

  onTick: (sec: number) => void = () => {};
  onEnd: () => void = () => {};

  get playing(): boolean {
    return this.ctx !== null;
  }

  play(score: ScoreState, bpm: number): void {
    this.stop();
    const AudioCtx: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);

    const { notes, totalSec } = buildSchedule(score, bpm);
    const t0 = ctx.currentTime + 0.12;

    for (const n of notes) {
      for (const f of n.freqs) {
        this.scheduleNote(ctx, master, f, t0 + n.startSec, n.durSec);
      }
    }

    const tick = () => {
      if (!this.ctx) return;
      const elapsed = this.ctx.currentTime - t0;
      this.onTick(Math.max(0, elapsed));
      if (elapsed >= totalSec + 0.05) {
        this.stop();
        this.onEnd();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private scheduleNote(ctx: AudioContext, dest: AudioNode, freq: number, start: number, dur: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;

    const gain = ctx.createGain();
    const attack = 0.006;
    const release = Math.min(0.12, dur * 0.4);
    const peak = 0.28;
    const susEnd = Math.max(start + attack, start + dur - release);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + attack);
    gain.gain.setValueAtTime(peak, susEnd);
    gain.gain.linearRampToValueAtTime(0, start + dur);

    osc.connect(gain);
    gain.connect(dest);
    osc.start(start);
    osc.stop(start + dur + 0.03);
    this.sources.push(osc);
  }

  stop(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    for (const o of this.sources) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
