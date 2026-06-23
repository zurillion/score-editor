import { ScoreState } from './types';
import { buildSchedule, occurrences, ScheduledNote } from './audio';
import { TICKS_PER_QUARTER } from './constants';

// Web MIDI is provided by the DOM lib (MIDIAccess / MIDIOutput); some browsers
// expose requestMIDIAccess only at runtime, so guard the navigator call.
type NavWithMidi = Navigator & {
  requestMIDIAccess?: (opts?: { sysex?: boolean }) => Promise<MIDIAccess>;
};

export interface MidiOutputInfo {
  id: string;
  name: string;
}

export function midiSupported(): boolean {
  return typeof (navigator as NavWithMidi).requestMIDIAccess === 'function';
}

export async function requestMidiAccess(): Promise<MIDIAccess | null> {
  const nav = navigator as NavWithMidi;
  if (!nav.requestMIDIAccess) return null;
  try {
    return await nav.requestMIDIAccess({ sysex: false });
  } catch {
    return null;
  }
}

export function listOutputs(access: MIDIAccess): MidiOutputInfo[] {
  return [...access.outputs.values()].map((o) => ({ id: o.id, name: o.name || o.id }));
}

/**
 * Plays a score by sending Web MIDI messages to an output on a chosen channel.
 * Like the audio Player, position is tracked in ticks and turned into real time
 * with the *current* tempo, so the BPM can change live (setBpm).
 */
export class MidiPlayer {
  private access: MIDIAccess;
  output: MIDIOutput | null = null;
  channel = 0; // 0..15
  loop = false;
  onTick: (tick: number) => void = () => {};
  onEnd: () => void = () => {};

  private raf = 0;
  private notes: ScheduledNote[] = []; // sorted by startTick
  private totalTicks = 0;
  private posTicks = 0;
  private scheduledTick = 0;
  private lastTime = 0; // performance.now() at the previous frame
  private secPerTick = 60 / 96 / TICKS_PER_QUARTER;
  private playingFlag = false;

  private static readonly LOOKAHEAD_SEC = 0.2; // keep a small window queued so Stop stays responsive

  constructor(access: MIDIAccess) {
    this.access = access;
  }

  get playing(): boolean {
    return this.playingFlag;
  }

  setOutput(id: string): void {
    this.output = this.access.outputs.get(id) ?? null;
  }

  setBpm(bpm: number): void {
    this.secPerTick = 60 / bpm / TICKS_PER_QUARTER;
  }

  play(score: ScoreState, bpm: number): void {
    this.stop();
    if (!this.output) return;
    const sched = buildSchedule(score);
    this.notes = sched.notes;
    this.totalTicks = sched.totalTicks;
    this.setBpm(bpm);
    this.posTicks = 0;
    this.scheduledTick = 0;
    this.lastTime = performance.now();
    this.playingFlag = true;

    const frame = () => {
      if (!this.playingFlag || !this.output) return;
      const now = performance.now();
      this.posTicks += (now - this.lastTime) / 1000 / this.secPerTick;
      this.lastTime = now;
      const ch = this.channel & 0x0f;

      if (!this.loop && this.totalTicks > 0 && this.posTicks >= this.totalTicks) {
        this.onTick(this.totalTicks);
        this.stop();
        this.onEnd();
        return;
      }

      const target = this.posTicks + MidiPlayer.LOOKAHEAD_SEC / this.secPerTick;
      if (target > this.scheduledTick) {
        for (const n of this.notes) {
          for (const g of occurrences(n.startTick, this.totalTicks, this.loop, this.scheduledTick, target)) {
            const onMs = now + Math.max(0, (g - this.posTicks) * this.secPerTick * 1000);
            const offMs = onMs + n.durTicks * this.secPerTick * 1000;
            for (const m of n.midis) {
              this.output.send([0x90 | ch, m, 96], onMs);
              this.output.send([0x80 | ch, m, 0], offMs);
            }
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

  stop(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    if (this.output) {
      const ch = this.channel & 0x0f;
      try {
        // clear() drops queued messages where supported; it's not in every typedef.
        (this.output as MIDIOutput & { clear?: () => void }).clear?.();
      } catch {
        /* ignore */
      }
      this.output.send([0xb0 | ch, 120, 0]); // all sound off
      this.output.send([0xb0 | ch, 123, 0]); // all notes off
    }
    this.playingFlag = false;
  }
}
