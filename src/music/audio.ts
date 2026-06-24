import { Pitch, ScoreState } from './types';
import { eventTicks, pitchToFrequency, pitchToMidi } from './theory';
import { resolveMeasure } from './accidentals';
import { scoreMeta } from './meta';
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
  pickupTicks: number; // length of the leading anacrusis (0 if none) — skippable on loop
}

/**
 * Builds a tempo-independent schedule (positions in ticks). The players turn
 * ticks into real time on the fly, so the tempo can change during playback.
 */
export function buildSchedule(score: ScoreState): Schedule {
  const meta = scoreMeta(score);
  // Flatten to one entry per (pitch) occurrence in global time, so a tie of value
  // can merge a pitch across consecutive notes (within a bar or across bars).
  interface Entry { key: string; startG: number; endG: number; freq: number; midi: number; tie: boolean; absorbed: boolean }
  const entries: Entry[] = [];
  for (const mm of meta.measures) {
    const m = score.measures[mm.index];
    // accidentals (key signature + "lasts for the measure") resolved per measure, per its own key
    const resolved = resolveMeasure(m.events, mm.keySig);
    for (const ev of m.events) {
      if (ev.kind !== 'note') continue;
      const startG = mm.startTick + ev.startTick;
      const endG = startG + eventTicks(ev);
      for (const p of ev.pitches) {
        const r = resolved.get(`${ev.id}|${p.step}${p.octave}`);
        const eff = r ? { ...p, alter: r.alter } : p;
        entries.push({ key: `${ev.staff}|${p.step}${p.octave}`, startG, endG, freq: pitchToFrequency(eff), midi: pitchToMidi(eff), tie: !!ev.tieToNext, absorbed: false });
      }
    }
  }
  const byKey = new Map<string, Entry[]>();
  for (const e of entries) {
    const a = byKey.get(e.key) ?? [];
    a.push(e);
    byKey.set(e.key, a);
  }
  const notes: ScheduledNote[] = [];
  for (const arr of byKey.values()) {
    arr.sort((a, b) => a.startG - b.startG);
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].absorbed) continue;
      let end = arr[i].endG;
      let j = i;
      while (arr[j].tie && j + 1 < arr.length && arr[j + 1].startG === end) {
        arr[j + 1].absorbed = true; // tied continuation: don't re-attack it
        end = arr[j + 1].endG;
        j++;
      }
      notes.push({ startTick: arr[i].startG, durTicks: end - arr[i].startG, freqs: [arr[i].freq], midis: [arr[i].midi] });
    }
  }
  notes.sort((a, b) => a.startTick - b.startTick);
  const pickupTicks = meta.measures[0]?.pickup ? meta.measures[0].total : 0;
  return { notes, totalTicks: meta.totalTicks, pickupTicks };
}

/**
 * Enumerate the global ticks at which a note starting at `startTick` falls within
 * [lo, hi). Every note plays once on the first pass; when looping, only the body
 * after `loopStart` repeats (so a leading anacrusis is heard once, not every loop).
 */
export function occurrences(
  startTick: number,
  totalTicks: number,
  loop: boolean,
  lo: number,
  hi: number,
  loopStart = 0,
): number[] {
  const out: number[] = [];
  if (startTick >= lo && startTick < hi) out.push(startTick); // first pass: play once at its own spot
  if (!loop || totalTicks <= 0) return out;
  const body = totalTicks - loopStart;
  if (body <= 0 || startTick < loopStart) return out; // notes before loopStart never repeat
  const base = totalTicks + (startTick - loopStart);
  let k = Math.ceil((lo - base) / body);
  if (k < 0) k = 0;
  for (let g = base + k * body; g < hi; g += body) if (g >= lo) out.push(g);
  return out;
}

/** Musical position (tick) of the playhead for a given elapsed `posTicks` when looping. */
export function loopPos(posTicks: number, totalTicks: number, loopStart: number): number {
  if (totalTicks <= 0) return 0;
  if (posTicks < totalTicks) return Math.max(0, posTicks);
  const body = totalTicks - loopStart;
  if (body <= 0) return totalTicks;
  return loopStart + ((posTicks - totalTicks) % body);
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
  private pickupTicks = 0; // leading anacrusis length
  private posTicks = 0; // continuous musical position (counts across loops)
  private scheduledTick = 0; // global tick we've scheduled up to
  private lastTime = 0; // ctx.currentTime at the previous frame
  private secPerTick = 60 / 96 / TICKS_PER_QUARTER;

  private static readonly LOOKAHEAD_SEC = 0.1;

  loop = false;
  skipPickupInLoop = true; // play a leading anacrusis once, then loop only the body
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
    this.pickupTicks = sched.pickupTicks;
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
      const loopStart = this.skipPickupInLoop ? this.pickupTicks : 0;

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
          for (const g of occurrences(n.startTick, this.totalTicks, this.loop, this.scheduledTick, target, loopStart)) {
            const start = Math.max(now, now + (g - this.posTicks) * this.secPerTick);
            for (const f of n.freqs) this.scheduleNote(start, n.durTicks * this.secPerTick, f);
          }
        }
        this.scheduledTick = target;
      }

      const pos = this.loop && this.totalTicks > 0 ? loopPos(this.posTicks, this.totalTicks, loopStart) : Math.min(this.posTicks, this.totalTicks);
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
