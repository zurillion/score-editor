import { ScoreState, TimeSignature } from './types';
import { measureTicks } from './theory';

/** Effective metadata for one measure once per-measure time/key overrides are resolved. */
export interface MeasureMeta {
  index: number;
  ts: TimeSignature;
  keySig: number;
  total: number; // ticks in this measure
  startTick: number; // global cumulative start
  tsChanged: boolean; // time signature differs from the previous measure
  keyChanged: boolean; // key signature differs from the previous measure
  prevKeySig: number; // previous measure's effective key (for cancellation naturals)
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
    const total = measureTicks(curTs);
    const meta: MeasureMeta = {
      index: i,
      ts: curTs,
      keySig: curKey,
      total,
      startTick: start,
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
