import { Pitch, ScoreState } from './types';
import { durationTicks, measureTicks, pitchToFrequency, pitchToMidi } from './theory';
import { resolveMeasure } from './accidentals';
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
  midis: number[];
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
    // accidentals (key signature + "lasts for the measure") resolved per measure
    const resolved = resolveMeasure(m.events, score.keySignature);
    for (const ev of m.events) {
      if (ev.kind !== 'note') continue;
      const startSec = (measureStart + ev.startTick) * secPerTick;
      const durSec = durationTicks(ev.duration) * secPerTick;
      const eff = ev.pitches.map((p) => {
        const r = resolved.get(`${ev.id}|${p.step}${p.octave}`);
        return r ? { ...p, alter: r.alter } : p;
      });
      notes.push({ startSec, durSec, freqs: eff.map(pitchToFrequency), midis: eff.map(pitchToMidi) });
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
  private master: GainNode | null = null;
  private sources = new Set<OscillatorNode>();
  private raf = 0;

  // scheduling state for the current run
  private notes: ScheduledNote[] = [];
  private totalSec = 0;
  private t0 = 0;
  private scheduledIters = 0;

  loop = false;
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
    this.master = master;

    const sched = buildSchedule(score, bpm);
    this.notes = sched.notes;
    this.totalSec = sched.totalSec;
    this.t0 = ctx.currentTime + 0.12;
    this.scheduledIters = 0;
    this.scheduleUpTo(this.loop ? 2 : 1); // pre-schedule an extra iteration for a seamless loop

    const tick = () => {
      if (!this.ctx) return;
      const elapsed = this.ctx.currentTime - this.t0;
      if (this.loop && this.totalSec > 0) {
        const pos = elapsed <= 0 ? 0 : elapsed % this.totalSec;
        this.onTick(pos);
        const cur = Math.max(0, Math.floor(elapsed / this.totalSec));
        this.scheduleUpTo(cur + 2); // keep one iteration scheduled ahead
      } else {
        this.onTick(Math.max(0, elapsed));
        if (elapsed >= this.totalSec + 0.05) {
          this.stop();
          this.onEnd();
          return;
        }
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private scheduleUpTo(n: number): void {
    if (this.totalSec <= 0) return;
    while (this.scheduledIters < n) {
      const base = this.t0 + this.scheduledIters * this.totalSec;
      for (const note of this.notes) {
        for (const f of note.freqs) this.scheduleNote(base + note.startSec, note.durSec, f);
      }
      this.scheduledIters++;
    }
  }

  private scheduleNote(start: number, dur: number, freq: number): void {
    const ctx = this.ctx;
    const dest = this.master;
    if (!ctx || !dest) return;
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
    this.sources.add(osc);
    osc.onended = () => this.sources.delete(osc); // prune so a long loop doesn't accumulate
  }

  stop(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    for (const o of this.sources) {
      try {
        o.onended = null;
        o.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.master = null;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
