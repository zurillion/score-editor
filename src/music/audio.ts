import { Pitch, ScoreState } from './types';
import { eventTicks, pitchToFrequency, pitchToMidi } from './theory';
import { resolveMeasure } from './accidentals';
import { scoreMeta } from './meta';
import { TICKS_PER_QUARTER } from './constants';
import { Sampler, nearestZone } from './instruments';

/**
 * Start one note at `start` for `dur` seconds on `dest`: an AudioBufferSource
 * pitch-shifted from the nearest sampled zone when a sampler is given, the
 * classic triangle oscillator ("8 bit sound") otherwise.
 */
function startVoice(
  ctx: BaseAudioContext,
  dest: AudioNode,
  sampler: Sampler | null,
  start: number,
  dur: number,
  freq: number,
  midi: number,
): AudioScheduledSourceNode {
  const gain = ctx.createGain();
  gain.connect(dest);
  let src: AudioScheduledSourceNode;
  let stopAt: number;
  if (sampler) {
    const zone = nearestZone(sampler, midi);
    const node = ctx.createBufferSource();
    node.buffer = zone.buffer;
    node.playbackRate.value = Math.pow(2, (midi - zone.midi) / 12);
    // Samples carry their own attack/decay: sustain for the full value, then
    // a short release past the end so the cutoff doesn't click.
    const release = 0.12;
    const peak = 0.8;
    gain.gain.setValueAtTime(peak, start);
    gain.gain.setValueAtTime(peak, start + dur);
    gain.gain.linearRampToValueAtTime(0, start + dur + release);
    node.connect(gain);
    src = node;
    stopAt = start + dur + release + 0.03;
  } else {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const attack = 0.006;
    const release = Math.min(0.12, dur * 0.4);
    const peak = 0.28;
    const susEnd = Math.max(start + attack, start + dur - release);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + attack);
    gain.gain.setValueAtTime(peak, susEnd);
    gain.gain.linearRampToValueAtTime(0, start + dur);
    osc.connect(gain);
    src = osc;
    stopAt = start + dur + 0.03;
  }
  src.start(start);
  src.stop(stopAt);
  return src;
}

// ---- One-shot audio preview ----
// Used by the "play note on creation" option. Keeps a single shared
// AudioContext alive so we don't spawn one per click.
let previewCtx: AudioContext | null = null;

/** Play the given pitches immediately with a short, fixed-length envelope. */
export function playPreview(pitches: Pitch[], durSec = 0.5, sampler: Sampler | null = null): void {
  if (pitches.length === 0) return;
  const AudioCtx: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!previewCtx) previewCtx = new AudioCtx();
  const ctx = previewCtx;
  if (ctx.state === 'suspended') void ctx.resume();

  const t0 = ctx.currentTime + 0.005;
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);

  for (const p of pitches) startVoice(ctx, master, sampler, t0, durSec, pitchToFrequency(p), pitchToMidi(p));
}

export interface ScheduledNote {
  startTick: number; // playback tick (repeats already expanded)
  durTicks: number;
  freqs: number[];
  midis: number[];
}

/** One contiguous stretch of the score as it appears in playback order. */
export interface PlaySegment {
  playStart: number; // where this stretch begins on the playback timeline
  scoreStart: number; // the score tick it corresponds to
  len: number;
}

export interface Schedule {
  notes: ScheduledNote[]; // sorted by startTick, in playback ticks
  totalTicks: number; // playback length (ends at the ∞ section's end when one exists)
  pickupTicks: number; // length of the leading anacrusis (0 if none) — skippable on loop
  segments: PlaySegment[]; // playback ↔ score tick mapping (identity when there are no repeats)
  forcedLoopStart?: number; // playback tick where an infinite (times = 0) repeat section starts
}

/** Score tick shown by the playhead for a playback tick. */
export function playToScoreTick(sched: Schedule, playTick: number): number {
  const segs = sched.segments;
  if (segs.length === 0) return Math.max(0, playTick);
  for (const s of segs) if (playTick < s.playStart + s.len) return s.scoreStart + Math.max(0, playTick - s.playStart);
  const last = segs[segs.length - 1];
  return last.scoreStart + last.len;
}

/** First playback occurrence of a score tick (0 when it's never reached, e.g. past an ∞ section). */
export function scoreToPlayTick(sched: Schedule, scoreTick: number): number {
  for (const s of sched.segments) if (scoreTick >= s.scoreStart && s.len > 0 && scoreTick < s.scoreStart + s.len) return s.playStart + (scoreTick - s.scoreStart);
  return 0;
}

/**
 * Playback order of the measures once repeat signs are applied. A :| jumps back
 * to the matching |: (or to the start of the unconsumed part when there is
 * none, playing that stretch twice). The |: sign's `times` is the total number
 * of plays of the section (1 = plays once, as without signs); times = 0 marks
 * the section as an endless loop: playback is truncated there and the players
 * cycle it. Repeats are consumed left to right; nesting is not supported.
 */
function expandRepeats(score: ScoreState, meta: ReturnType<typeof scoreMeta>): { segments: PlaySegment[]; forcedLoopStart?: number } {
  const ms = score.measures;
  const ranges: { from: number; to: number }[] = [];
  let forced: { from: number; to: number } | null = null;
  let cursor = 0;
  for (let e = 0; e < ms.length && !forced; e++) {
    if (!ms[e].repeatEnd || e < cursor) continue;
    let s = cursor;
    for (let i = e; i >= cursor; i--) {
      if (ms[i].repeatStart) {
        s = i;
        break;
      }
    }
    const times = ms[s].repeatStart ? Math.max(0, Math.round(ms[s].repeatStart!.times)) : 2;
    if (s > cursor) ranges.push({ from: cursor, to: s - 1 });
    if (times === 0) {
      forced = { from: s, to: e };
      break;
    }
    for (let k = 0; k < times; k++) ranges.push({ from: s, to: e });
    cursor = e + 1;
  }
  if (forced) ranges.push(forced);
  else if (cursor < ms.length) ranges.push({ from: cursor, to: ms.length - 1 });

  const segments: PlaySegment[] = [];
  let playStart = 0;
  for (const r of ranges) {
    const a = meta.measures[r.from];
    const b = meta.measures[r.to];
    const len = b.startTick + b.total - a.startTick;
    segments.push({ playStart, scoreStart: a.startTick, len });
    playStart += len;
  }
  return { segments, ...(forced ? { forcedLoopStart: playStart - segments[segments.length - 1].len } : {}) };
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
  const scoreNotes: ScheduledNote[] = [];
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
      scoreNotes.push({ startTick: arr[i].startG, durTicks: end - arr[i].startG, freqs: [arr[i].freq], midis: [arr[i].midi] });
    }
  }
  const pickupTicks = meta.measures[0]?.pickup ? meta.measures[0].total : 0;

  const hasRepeats = score.measures.some((m) => m.repeatStart || m.repeatEnd);
  if (!hasRepeats) {
    scoreNotes.sort((a, b) => a.startTick - b.startTick);
    return { notes: scoreNotes, totalTicks: meta.totalTicks, pickupTicks, segments: [{ playStart: 0, scoreStart: 0, len: meta.totalTicks }] };
  }

  // Copy the score notes into each playback pass of their segment. A note that
  // would ring past a repeat jump is clipped at the segment boundary.
  const { segments, forcedLoopStart } = expandRepeats(score, meta);
  const notes: ScheduledNote[] = [];
  for (const seg of segments) {
    const segEnd = seg.scoreStart + seg.len;
    for (const n of scoreNotes) {
      if (n.startTick < seg.scoreStart || n.startTick >= segEnd) continue;
      notes.push({ ...n, startTick: seg.playStart + (n.startTick - seg.scoreStart), durTicks: Math.min(n.durTicks, segEnd - n.startTick) });
    }
  }
  notes.sort((a, b) => a.startTick - b.startTick);
  const totalTicks = segments.length ? segments[segments.length - 1].playStart + segments[segments.length - 1].len : 0;
  return { notes, totalTicks, pickupTicks, segments, ...(forcedLoopStart !== undefined ? { forcedLoopStart } : {}) };
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
  private sources = new Set<AudioScheduledSourceNode>();
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
  sampler: Sampler | null = null; // sampled instrument; null = built-in synth ("8 bit sound")
  onTick: (tick: number) => void = () => {};
  onEnd: () => void = () => {};

  get playing(): boolean {
    return this.ctx !== null;
  }

  setBpm(bpm: number): void {
    this.secPerTick = 60 / bpm / TICKS_PER_QUARTER;
  }

  play(score: ScoreState, bpm: number, startTick = 0): void {
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
    const forcedLoopStart = sched.forcedLoopStart ?? null;
    this.setBpm(bpm);
    const from = scoreToPlayTick(sched, Math.max(0, startTick)); // startTick is a score tick
    this.posTicks = from;
    this.scheduledTick = from;
    this.lastTime = ctx.currentTime;

    const frame = () => {
      const c = this.ctx;
      if (!c) return;
      const now = c.currentTime;
      this.posTicks += (now - this.lastTime) / this.secPerTick;
      this.lastTime = now;
      // an ∞ repeat cycles its own section regardless of the Loop toggle
      const looping = this.loop || forcedLoopStart !== null;
      const loopStart = forcedLoopStart ?? (this.skipPickupInLoop ? this.pickupTicks : 0);

      const tail = 0.12 / this.secPerTick; // let the final note's release ring out
      if (!looping && this.totalTicks > 0 && this.posTicks >= this.totalTicks + tail) {
        this.onTick(playToScoreTick(sched, this.totalTicks));
        this.stop();
        this.onEnd();
        return;
      }

      const target = this.posTicks + Player.LOOKAHEAD_SEC / this.secPerTick;
      if (target > this.scheduledTick) {
        for (const n of this.notes) {
          for (const g of occurrences(n.startTick, this.totalTicks, looping, this.scheduledTick, target, loopStart)) {
            const start = Math.max(now, now + (g - this.posTicks) * this.secPerTick);
            for (let i = 0; i < n.freqs.length; i++) this.scheduleNote(start, n.durTicks * this.secPerTick, n.freqs[i], n.midis[i]);
          }
        }
        this.scheduledTick = target;
      }

      const pos = looping && this.totalTicks > 0 ? loopPos(this.posTicks, this.totalTicks, loopStart) : Math.min(this.posTicks, this.totalTicks);
      this.onTick(playToScoreTick(sched, Math.max(0, pos)));
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private scheduleNote(start: number, dur: number, freq: number, midi: number): void {
    const ctx = this.ctx;
    const dest = this.master;
    if (!ctx || !dest) return;
    const src = startVoice(ctx, dest, this.sampler, start, dur, freq, midi);
    this.sources.add(src);
    src.onended = () => this.sources.delete(src); // prune so a long loop doesn't accumulate
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
