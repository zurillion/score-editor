import { Alter, Measure, NoteEvent, Pitch, ScoreEvent, ScoreState, Staff, StepName, TimeSignature } from './types';
import { durationTicks, measureTicks } from './theory';

// ---------------------------------------------------------------------------
// Tiny authoring DSL for the built-in library.
//
// A "token" is `<pitch>/<dur>` where
//   pitch  = note letter + optional accidental + octave   e.g. C4, F#3, Bb5, Fx4, Bbb2
//            a chord joins pitches with '+'               e.g. C4+E4+G4
//            'r' is a rest
//   dur    = w h q e s t   (whole, half, quarter, eighth, 16th, 32nd)
//            optionally followed by '.' or '..' for augmentation dots
//
// A "voice" is a whitespace-separated string of tokens, read left to right.
// `buildScore` lays two voices (right hand / left hand) onto the grand staff,
// splitting each voice into measures by the time signature.
// ---------------------------------------------------------------------------

const DUR_VALUE: Record<string, 1 | 2 | 4 | 8 | 16 | 32> = { w: 1, h: 2, q: 4, e: 8, s: 16, t: 32 };
const ACCIDENTAL: Record<string, Alter> = { bb: -2, b: -1, '': 0, '#': 1, x: 2 };

function parsePitch(tok: string): Pitch {
  // letter, accidental (bb|b|#|x), octave (may be negative)
  const m = /^([A-Ga-g])(bb|b|#|x)?(-?\d+)$/.exec(tok);
  if (!m) throw new Error(`bad pitch token: "${tok}"`);
  return { step: m[1].toUpperCase() as StepName, alter: ACCIDENTAL[m[2] ?? ''], octave: Number(m[3]) };
}

interface ParsedEvent {
  pitches: Pitch[] | null; // null => rest
  value: 1 | 2 | 4 | 8 | 16 | 32;
  dots: 0 | 1 | 2;
}

function parseToken(tok: string): ParsedEvent {
  const slash = tok.lastIndexOf('/');
  if (slash < 0) throw new Error(`token without duration: "${tok}"`);
  const head = tok.slice(0, slash);
  const durStr = tok.slice(slash + 1);
  const dots = (durStr.match(/\./g)?.length ?? 0) as 0 | 1 | 2;
  const value = DUR_VALUE[durStr.replace(/\./g, '')];
  if (!value) throw new Error(`bad duration in "${tok}"`);
  const pitches = head === 'r' ? null : head.split('+').map(parsePitch);
  return { pitches, value, dots };
}

interface VoiceEvent extends ParsedEvent {
  startTick: number; // absolute from the start of the piece
}

function parseVoice(src: string): VoiceEvent[] {
  let tick = 0;
  const out: VoiceEvent[] = [];
  for (const tok of src.trim().split(/\s+/).filter(Boolean)) {
    const ev = parseToken(tok);
    out.push({ ...ev, startTick: tick });
    tick += durationTicks({ value: ev.value, dots: ev.dots });
  }
  return out;
}

function toScoreEvents(idBase: string, staff: Staff, voice: VoiceEvent[], total: number): Map<number, ScoreEvent[]> {
  const byMeasure = new Map<number, ScoreEvent[]>();
  voice.forEach((ve, i) => {
    if (ve.pitches === null) return; // rests are implicit (we don't render gaps)
    const measureIndex = Math.floor(ve.startTick / total);
    const startTick = ve.startTick - measureIndex * total;
    const duration = { value: ve.value, dots: ve.dots };
    const ev: NoteEvent = {
      id: `${idBase}-${i}`,
      kind: 'note',
      staff,
      startTick,
      duration,
      pitches: ve.pitches,
    };
    const list = byMeasure.get(measureIndex) ?? [];
    list.push(ev);
    byMeasure.set(measureIndex, list);
  });
  return byMeasure;
}

interface PieceDef {
  id: string;
  title: string;
  subtitle: string;
  ts: TimeSignature;
  bpm: number;
  rh: string; // right hand (treble)
  lh: string; // left hand (bass)
}

export interface LibraryPiece {
  id: string;
  title: string;
  subtitle: string;
  bpm: number;
  score: ScoreState;
}

function buildScore(def: PieceDef): LibraryPiece {
  const total = measureTicks(def.ts);
  const rh = toScoreEvents(`${def.id}-rh`, 'treble', parseVoice(def.rh), total);
  const lh = toScoreEvents(`${def.id}-lh`, 'bass', parseVoice(def.lh), total);
  const count = Math.max(0, ...rh.keys(), ...lh.keys()) + 1;
  const measures: Measure[] = [];
  for (let i = 0; i < count; i++) {
    const events = [...(rh.get(i) ?? []), ...(lh.get(i) ?? [])].sort((a, b) => a.startTick - b.startTick);
    measures.push({ id: `${def.id}-m${i}`, events });
  }
  return {
    id: def.id,
    title: def.title,
    subtitle: def.subtitle,
    bpm: def.bpm,
    score: { timeSignature: def.ts, keySignature: 0, measures },
  };
}

// ---------------------------------------------------------------------------
// The pieces. Melodies are authentic; for folk tunes the bass is a plain,
// harmonically standard accompaniment. Excerpts are the opening phrases.
// ---------------------------------------------------------------------------

const DEFS: PieceDef[] = [
  {
    id: 'ode-to-joy',
    title: 'Inno alla gioia',
    subtitle: 'Beethoven — Sinfonia n. 9',
    ts: { numerator: 4, denominator: 4 },
    bpm: 112,
    rh: `E4/q E4/q F4/q G4/q  G4/q F4/q E4/q D4/q  C4/q C4/q D4/q E4/q  E4/q. D4/e D4/h
         E4/q E4/q F4/q G4/q  G4/q F4/q E4/q D4/q  C4/q C4/q D4/q E4/q  D4/q. C4/e C4/h`,
    lh: `C3+E3/h C3+G3/h  G2+D3/h G2+B2/h  C3+E3/h C3+G3/h  G2+B2/h G2+D3/h
         C3+E3/h C3+G3/h  G2+D3/h G2+B2/h  C3+E3/h G2+D3/h  G2+B2/h C3+E3/h`,
  },
  {
    id: 'twinkle',
    title: 'Twinkle, Twinkle, Little Star',
    subtitle: 'Mozart — tema (Ah! vous dirai-je, maman)',
    ts: { numerator: 4, denominator: 4 },
    bpm: 104,
    rh: `C4/q C4/q G4/q G4/q  A4/q A4/q G4/h  F4/q F4/q E4/q E4/q  D4/q D4/q C4/h
         G4/q G4/q F4/q F4/q  E4/q E4/q D4/h  G4/q G4/q F4/q F4/q  E4/q E4/q D4/h`,
    lh: `C3+E3/h C3+E3/h  F2+A2/h C3+E3/h  F2+A2/h C3+E3/h  G2+B2/h C3+E3/h
         C3+E3/h B2+D3/h  C3+E3/h G2+B2/h  C3+E3/h B2+D3/h  C3+E3/h G2+C3/h`,
  },
  {
    id: 'minuet-g',
    title: 'Minuetto in Sol',
    subtitle: 'Petzold (attr. Bach) — BWV Anh. 114',
    ts: { numerator: 3, denominator: 4 },
    bpm: 120,
    rh: `D5/q G4/e A4/e B4/e C5/e  D5/q G4/q G4/q  E5/q C5/e D5/e E5/e F#5/e  G5/q G4/q G4/q
         C5/q D5/e C5/e B4/e A4/e  B4/q C5/e B4/e A4/e G4/e  F#4/q G4/e A4/e B4/e G4/e  A4/h.`,
    lh: `G2+B2/h. G2/q B2/q C3/q  C3/q B2/q C3/q  B2/h.
         A2/h. D3/q D2/q F#2/q  G2/q D3/q D3/q  D2/h.`,
  },
  {
    id: 'frere-jacques',
    title: 'Frère Jacques',
    subtitle: 'Tradizionale — canone',
    ts: { numerator: 4, denominator: 4 },
    bpm: 108,
    rh: `C4/q D4/q E4/q C4/q  C4/q D4/q E4/q C4/q  E4/q F4/q G4/h  E4/q F4/q G4/h
         G4/e A4/e G4/e F4/e E4/q C4/q  G4/e A4/e G4/e F4/e E4/q C4/q  C4/q G3/q C4/h  C4/q G3/q C4/h`,
    lh: `C3+E3+G3/w  C3+E3+G3/w  C3+E3+G3/w  C3+E3+G3/w
         C3+E3+G3/w  C3+E3+G3/w  C3+G3/w  C3+E3+G3/w`,
  },
  {
    id: 'prelude-c',
    title: 'Preludio in Do',
    subtitle: 'Bach — WTC I, BWV 846',
    ts: { numerator: 4, denominator: 4 },
    bpm: 72,
    rh: `E4/s G4/s C5/s E4/s G4/s C5/s E4/s G4/s C5/s E4/s G4/s C5/s E4/s G4/s C5/s E4/s
         D4/s F4/s A4/s D4/s F4/s A4/s D4/s F4/s A4/s D4/s F4/s A4/s D4/s F4/s A4/s D4/s
         D4/s G4/s B4/s D4/s G4/s B4/s D4/s G4/s B4/s D4/s G4/s B4/s D4/s G4/s B4/s D4/s
         C4/s E4/s G4/s C5/s E4/s G4/s C5/s E4/s C4/s E4/s G4/s C5/s E4/s G4/s C5/s E4/s`,
    lh: `C3/h C3/h  C3/h C3/h  B2/h B2/h  C3/h C3/h`,
  },
  {
    id: 'eine-kleine',
    title: 'Eine kleine Nachtmusik',
    subtitle: 'Mozart — K. 525 (apertura)',
    ts: { numerator: 4, denominator: 4 },
    bpm: 132,
    rh: `G4/q D4/q G4/e D4/e G4/q  B4/e D5/e G5/q r/q
         D5/q A4/q D4/e A4/e D5/q  F#4/e A4/e D5/q r/q`,
    lh: `G2+B2+D3/q r/q G2+B2+D3/e r/e G2+B2+D3/q  G2+B2+D3/e r/e G2/q G2/q
         D3+F#3+A3/q r/q D3+F#3+A3/e r/e D3+F#3+A3/q  D3+F#3+A3/e r/e D2/q D2/q`,
  },
  {
    id: 'mary-lamb',
    title: 'Mary Had a Little Lamb',
    subtitle: 'Tradizionale',
    ts: { numerator: 4, denominator: 4 },
    bpm: 100,
    rh: `E4/q D4/q C4/q D4/q  E4/q E4/q E4/h  D4/q D4/q D4/h  E4/q G4/q G4/h
         E4/q D4/q C4/q D4/q  E4/q E4/q E4/q E4/q  D4/q D4/q E4/q D4/q  C4/w`,
    lh: `C3+E3+G3/w  C3+E3+G3/w  G2+B2+D3/w  C3+E3+G3/w
         C3+E3+G3/w  C3+E3+G3/w  G2+B2+D3/w  C3+E3+G3/w`,
  },
  {
    id: 'row-your-boat',
    title: 'Row, Row, Row Your Boat',
    subtitle: 'Tradizionale — 6/8',
    ts: { numerator: 6, denominator: 8 },
    bpm: 96,
    rh: `C4/q. C4/q.  C4/q D4/e E4/q.  E4/q D4/e E4/q F4/e  G4/h.
         C5/e C5/e C5/e G4/e G4/e G4/e  E4/e E4/e E4/e C4/e C4/e C4/e  G4/q F4/e E4/q D4/e  C4/h.`,
    lh: `C3+G3/h.  C3+G3/h.  C3+G3/h.  C3+G3/h.
         C3+E3/h.  C3+E3/h.  G2+D3/h.  C3+G3/h.`,
  },
  {
    id: 'au-clair-de-la-lune',
    title: 'Au clair de la lune',
    subtitle: 'Tradizionale francese',
    ts: { numerator: 4, denominator: 4 },
    bpm: 96,
    rh: `C4/q C4/q C4/q D4/q  E4/h D4/h  C4/q E4/q D4/q D4/q  C4/w
         C4/q C4/q C4/q D4/q  E4/h D4/h  C4/q E4/q D4/q D4/q  C4/w`,
    lh: `C3+E3+G3/w  G2+B2+D3/w  C3+E3+G3/w  C3+E3+G3/w
         C3+E3+G3/w  G2+B2+D3/w  G2+B2+D3/w  C3+E3+G3/w`,
  },
  {
    id: 'jingle-bells',
    title: 'Jingle Bells',
    subtitle: 'Pierpont — ritornello',
    ts: { numerator: 4, denominator: 4 },
    bpm: 120,
    rh: `E4/q E4/q E4/h  E4/q E4/q E4/h  E4/q G4/q C4/q. D4/e  E4/w
         F4/q F4/q F4/q. F4/e  F4/q E4/q E4/q E4/e E4/e  E4/q D4/q D4/q E4/q  D4/h G4/h`,
    lh: `C3+G3/h C3+G3/h  C3+G3/h C3+G3/h  C3+E3/h G2+G3/h  C3+E3+G3/w
         F2+F3/h F2+F3/h  C3+E3/h C3+E3/h  G2+G3/h G2+B2/h  G2+G3/h G2+B2+D3/h`,
  },
];

export const LIBRARY: LibraryPiece[] = DEFS.map(buildScore);
