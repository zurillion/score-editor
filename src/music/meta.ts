import { Measure, ScoreState, TimeSignature } from './types';
import { durationTicks, measureTicks } from './theory';
import { TICKS_PER_QUARTER } from './constants';

const PICKUP_MARGIN = TICKS_PER_QUARTER; // clickable room (a beat) past the anacrusis content, to append

/** Effective metadata for one measure once per-measure time/key overrides are resolved. */
export interface MeasureMeta {
  index: number;
  ts: TimeSignature;
  keySig: number;
  total: number; // canonical length in ticks (where the next measure starts; what plays)
  spanTicks: number; // ticks spanned by the drawn width (= total, except an anacrusis adds editing room)
  capacityTicks: number; // max ticks that may be placed here (a full bar even for an anacrusis)
  startTick: number; // global cumulative start
  pickup: boolean;
  tsChanged: boolean; // time signature differs from the previous measure
  keyChanged: boolean; // key signature differs from the previous measure
  prevKeySig: number; // previous measure's effective key (for cancellation naturals)
}

/** End tick of the last event across both staves (the anacrusis "content length"). */
export function contentEndTicks(m: Measure): number {
  return m.events.reduce((mx, e) => Math.max(mx, e.startTick + durationTicks(e.duration)), 0);
}

export interface ScoreMeta {
  measures: MeasureMeta[];
  totalTicks: number;
}

function sameTs(a: TimeSignature, b: TimeSignature): boolean {
  return a.numerator === b.numerator && a.denominator === b.denominator;
}

/**
 * Resolves the effective time signature / key for every measure. A measure's
 * `timeSignature` / `keySignature` override starts there and stays in effect
 * until the next override, so the effective value is the most recent override
 * at or before the measure (the score-level values are the initial defaults).
 */
export function scoreMeta(score: ScoreState): ScoreMeta {
  let curTs = score.timeSignature;
  let curKey = score.keySignature;
  let start = 0;
  const measures: MeasureMeta[] = score.measures.map((m, i) => {
    const prevTs = curTs;
    const prevKey = curKey;
    if (m.timeSignature) curTs = m.timeSignature;
    if (m.keySignature !== undefined) curKey = m.keySignature;
    // an anacrusis is the upbeat of the bar it leads into: it shares that bar's
    // meter/key (shown once at the start) rather than introducing one of its own.
    if (i === 0 && m.pickup && score.measures.length > 1) {
      const next = score.measures[1];
      if (next.timeSignature) curTs = next.timeSignature;
      if (next.keySignature !== undefined) curKey = next.keySignature;
    }
    const full = measureTicks(curTs);
    let total = full;
    let spanTicks = full;
    if (m.pickup) {
      const content = Math.min(full, contentEndTicks(m));
      total = content; // an anacrusis is only as long as its content (the rest "doesn't exist")
      spanTicks = m.events.length ? Math.min(full, content + PICKUP_MARGIN) : full; // empty -> full width to start filling
      spanTicks = Math.max(spanTicks, PICKUP_MARGIN);
    }
    const meta: MeasureMeta = {
      index: i,
      ts: curTs,
      keySig: curKey,
      total,
      spanTicks,
      capacityTicks: full,
      startTick: start,
      pickup: !!m.pickup,
      tsChanged: i !== 0 && !sameTs(curTs, prevTs),
      keyChanged: i !== 0 && curKey !== prevKey,
      prevKeySig: prevKey,
    };
    start += total;
    return meta;
  });
  return { measures, totalTicks: start };
}

/** Index of the measure that contains a global tick (clamped to a valid measure). */
export function measureIndexAtTick(meta: ScoreMeta, tick: number): number {
  const ms = meta.measures;
  if (ms.length === 0) return 0;
  for (let i = 0; i < ms.length; i++) {
    if (tick < ms[i].startTick + ms[i].total) return i;
  }
  return ms.length - 1;
}

export function effectiveTimeSignatureAt(score: ScoreState, index: number): TimeSignature {
  let ts = score.timeSignature;
  for (let i = 0; i <= index && i < score.measures.length; i++) {
    const o = score.measures[i].timeSignature;
    if (o) ts = o;
  }
  return ts;
}

export function effectiveKeyAt(score: ScoreState, index: number): number {
  let k = score.keySignature;
  for (let i = 0; i <= index && i < score.measures.length; i++) {
    const o = score.measures[i].keySignature;
    if (o !== undefined) k = o;
  }
  return k;
}
