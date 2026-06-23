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
  startTick: number; // global, across measures
  durTicks: number;
  freqs: number[];
  midis: number[];
}

export interface Schedule {
  notes: ScheduledNote[]; // sorted by startTick
  totalTicks: number;
}

/**
 * Builds a tempo-independent schedule (positions in ticks). The players turn
 * ticks into real time on the fly, so the tempo can change during playback.
 */
export function buildSchedule(score: ScoreState): Schedule {
  const mTicks = measureTicks(score.timeSignature);
  const notes: ScheduledNote[] = [];
  let measureStart = 0;
  for (const m of score.measures) {
    // accidentals (key signature + "lasts for the measure") resolved per measure
    const resolved = resolveMeasure(m.events, score.keySignature);
    for (const ev of m.events) {
      if (ev.kind !== 'note') continue;
      const startTick = measureStart + ev.startTick;
      const durTicks = durationTicks(ev.duration);
      const eff = ev.pitches.map((p) => {
        const r = resolved.get(`${ev.id}|${p.step}${p.octave}`);
        return r ? { ...p, alter: r.alter } : p;
      });
      notes.push({ startTick, durTicks, freqs: eff.map(pitchToFrequency), midis: eff.map(pitchToMidi) });
    }
    measureStart += mTicks;
  }
  notes.sort((a, b) => a.startTick - b.startTick);
  return { notes, totalTicks: measureStart };
}

/** Enumerate the global ticks at which a note starting at `startTick` falls within [lo, hi). */
export function occurrences(startTick: number, totalTicks: number, loop: boolean, lo: number, hi: number): number[] {
  if (!loop) return startTick >= lo && startTick < hi ? [startTick] : [];
  if (totalTicks <= 0) return [];
  const out: number[] = [];
  let k = Math.ceil((lo - startTick) / totalTicks);
  if (k < 0) k = 0;
  for (let g = startTick + k * totalTicks; g < hi; g += totalTicks) {
    if (g >= lo) out.push(g);
  }
  return out;
}

/**
 * Polyphonic Web Audio player. Playback position is tracked in ticks and turned
 * into real time using the *current* tempo each animation frame, scheduling a
 * short window ahead. Because nothing far in the future is committed, the BPM
 * can be changed live (setBpm) and the speed adapts immediately.
 */
export class Player {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sources = new Set<OscillatorNode>();
  private raf = 0;

  private notes: ScheduledNote[] = []; // sorted by startTick
  private totalTicks = 0;
  private posTicks = 0; // continuous musical position (counts across loops)
  private scheduledTick = 0; // global tick we've scheduled up to
  private lastTime = 0; // ctx.currentTime at the previous frame
  private secPerTick = 60 / 96 / TICKS_PER_QUARTER;

  private static readonly LOOKAHEAD_SEC = 0.1;

  loop = false;
  onTick: (tick: number) => void = () => {};
  onEnd: () => void = () => {};

  get playing(): boolean {
    return this.ctx !== null;
  }

  setBpm(bpm: number): void {
    this.secPerTick = 60 / bpm / TICKS_PER_QUARTER;
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

    const sched = buildSchedule(score);
    this.notes = sched.notes;
    this.totalTicks = sched.totalTicks;
    this.setBpm(bpm);
    this.posTicks = 0;
    this.scheduledTick = 0;
    this.lastTime = ctx.currentTime;

    const frame = () => {
      const c = this.ctx;
      if (!c) return;
      const now = c.currentTime;
      this.posTicks += (now - this.lastTime) / this.secPerTick;
      this.lastTime = now;

      const tail = 0.12 / this.secPerTick; // let the final note's release ring out
      if (!this.loop && this.totalTicks > 0 && this.posTicks >= this.totalTicks + tail) {
        this.onTick(this.totalTicks);
        this.stop();
        this.onEnd();
        return;
      }

      const target = this.posTicks + Player.LOOKAHEAD_SEC / this.secPerTick;
      if (target > this.scheduledTick) {
        for (const n of this.notes) {
          for (const g of occurrences(n.startTick, this.totalTicks, this.loop, this.scheduledTick, target)) {
            const start = Math.max(now, now + (g - this.posTicks) * this.secPerTick);
            for (const f of n.freqs) this.scheduleNote(start, n.durTicks * this.secPerTick, f);
          }
        }
        this.scheduledTick = target;
      }

      const pos = this.loop && this.totalTicks > 0 ? this.posTicks % this.totalTicks : Math.min(this.posTicks, this.totalTicks);
      this.onTick(Math.max(0, pos));
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
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
