import { ScoreState } from './types';
import { buildSchedule, ScheduledNote } from './audio';

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

interface FlatEvent {
  onMs: number;
  offMs: number;
  midi: number;
}

/** Plays a score by sending Web MIDI messages to an output on a chosen channel. */
export class MidiPlayer {
  private access: MIDIAccess;
  output: MIDIOutput | null = null;
  channel = 0; // 0..15
  loop = false;
  onTick: (sec: number) => void = () => {};
  onEnd: () => void = () => {};

  private raf = 0;
  private t0 = 0;
  private notes: ScheduledNote[] = [];
  private totalSec = 0;
  private iter = 0;
  private flat: FlatEvent[] = [];
  private fi = 0;
  private playingFlag = false;

  constructor(access: MIDIAccess) {
    this.access = access;
  }

  get playing(): boolean {
    return this.playingFlag;
  }

  setOutput(id: string): void {
    this.output = this.access.outputs.get(id) ?? null;
  }

  private flatten(iter: number): FlatEvent[] {
    const base = this.t0 + iter * this.totalSec * 1000;
    const arr: FlatEvent[] = [];
    for (const note of this.notes) {
      const onMs = base + note.startSec * 1000;
      const offMs = base + (note.startSec + note.durSec) * 1000;
      for (const m of note.midis) arr.push({ onMs, offMs, midi: m });
    }
    arr.sort((a, b) => a.onMs - b.onMs);
    return arr;
  }

  play(score: ScoreState, bpm: number): void {
    this.stop();
    if (!this.output) return;
    const sched = buildSchedule(score, bpm);
    this.notes = sched.notes;
    this.totalSec = sched.totalSec;
    this.t0 = performance.now() + 150;
    this.iter = 0;
    this.flat = this.flatten(0);
    this.fi = 0;
    this.playingFlag = true;

    const LOOKAHEAD = 200; // ms; keep few messages queued so Stop is responsive
    const tick = () => {
      if (!this.playingFlag || !this.output) return;
      const now = performance.now();
      const ch = this.channel & 0x0f;
      while (this.fi < this.flat.length && this.flat[this.fi].onMs <= now + LOOKAHEAD) {
        const e = this.flat[this.fi];
        this.output.send([0x90 | ch, e.midi, 96], e.onMs);
        this.output.send([0x80 | ch, e.midi, 0], e.offMs);
        this.fi++;
      }
      if (this.fi >= this.flat.length && this.loop && this.totalSec > 0) {
        this.iter++;
        this.flat = this.flatten(this.iter);
        this.fi = 0;
      }
      const elapsed = (now - this.t0) / 1000;
      if (this.loop && this.totalSec > 0) {
        this.onTick(elapsed <= 0 ? 0 : elapsed % this.totalSec);
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
