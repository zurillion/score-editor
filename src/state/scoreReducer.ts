import { Alter, Duration, DurationValue, Measure, NoteEvent, Pitch, RestEvent, ScoreEvent, Staff, ScoreState, TimeSignature, Tuplet } from '../music/types';
import { diatonicToPitch, eventTicks, measureTicks, pitchEquals, pitchToDiatonic, staffForDiatonic } from '../music/theory';
import { effectiveTimeSignatureAt, scoreMeta } from '../music/meta';
import { classifyNote, classifyRest } from '../music/placement';
import { ClipNote } from './selection';

let idCounter = 0;
const uid = (prefix: string): string => `${prefix}${++idCounter}`;

export function emptyMeasure(): Measure {
  return { id: uid('m'), events: [] };
}

export function initialScore(measureCount = 4): ScoreState {
  return {
    timeSignature: { numerator: 4, denominator: 4 },
    keySignature: 0,
    measures: Array.from({ length: measureCount }, emptyMeasure),
  };
}

export type ScoreAction =
  | { type: 'CLICK_NOTE'; measureIndex: number; tick: number; pitch: Pitch; duration: Duration }
  | { type: 'CLICK_REST'; measureIndex: number; tick: number; duration: Duration; staff: Staff }
  | { type: 'SET_ACCIDENTAL'; measureIndex: number; eventId: string; diatonic: number; alter: Alter }
  | { type: 'SET_DOTS'; measureIndex: number; eventId: string; dots: 1 | 2 }
  | { type: 'MAKE_TUPLET'; measureIndex: number; eventId: string }
  | { type: 'ERASE'; measureIndex: number; eventId: string; diatonic: number | null }
  | { type: 'DELETE_MEASURES'; indices: number[] }
  | { type: 'DELETE_NOTES'; ids: string[] }
  | { type: 'TRANSPOSE_NOTES'; ids: string[]; delta: number }
  | { type: 'MOVE_NOTE'; measureIndex: number; eventId: string; fromDiatonic: number; toDiatonic: number }
  | { type: 'PASTE_NOTES'; baseTick: number; events: ClipNote[] }
  | { type: 'PASTE_MEASURES'; index: number; measures: Measure[] }
  | { type: 'SET_TIME_SIGNATURE_AT'; measureIndex: number; timeSignature: TimeSignature }
  | { type: 'SET_KEY_SIGNATURE_AT'; measureIndex: number; keySignature: number }
  | { type: 'SET_PICKUP'; on: boolean }
  | { type: 'ADD_MEASURE' }
  | { type: 'REMOVE_LAST_MEASURE' }
  | { type: 'CLEAR' }
  | { type: 'LOAD'; score: ScoreState };

function withMeasureEvents(state: ScoreState, index: number, events: ScoreEvent[]): ScoreState {
  const measures = state.measures.slice();
  measures[index] = { ...measures[index], events: sortEvents(events) };
  return { ...state, measures };
}

function sortEvents(events: ScoreEvent[]): ScoreEvent[] {
  return events.slice().sort((a, b) => a.startTick - b.startTick);
}
function sortPitches(pitches: Pitch[]): Pitch[] {
  return pitches.slice().sort((a, b) => pitchToDiatonic(a) - pitchToDiatonic(b));
}

/** Expand a set of event ids so that touching any tuplet member selects the whole group. */
function expandTupletIds(events: ScoreEvent[], ids: Set<string>): Set<string> {
  const groupIds = new Set<string>();
  for (const e of events) if (e.tuplet && ids.has(e.id)) groupIds.add(e.tuplet.id);
  if (groupIds.size === 0) return ids;
  const out = new Set(ids);
  for (const e of events) if (e.tuplet && groupIds.has(e.tuplet.id)) out.add(e.id);
  return out;
}

export function scoreReducer(state: ScoreState, action: ScoreAction): ScoreState {
  switch (action.type) {
    case 'CLICK_NOTE': {
      const m = state.measures[action.measureIndex];
      if (!m) return state;
      const total = measureTicks(effectiveTimeSignatureAt(state, action.measureIndex));
      const staff = staffForDiatonic(pitchToDiatonic(action.pitch));
      const verdict = classifyNote(m.events, action.tick, action.pitch, action.duration, total, staff);
      if (verdict === 'blocked') return state;

      if (verdict === 'create') {
        const note: NoteEvent = {
          id: uid('n'),
          kind: 'note',
          staff,
          startTick: action.tick,
          duration: action.duration,
          pitches: [action.pitch],
        };
        return withMeasureEvents(state, action.measureIndex, [...m.events, note]);
      }

      // chord / delete operate on the event of this staff that starts exactly here
      const target = m.events.find((e) => e.startTick === action.tick && e.staff === staff);
      if (!target || target.kind !== 'note') return state;

      if (verdict === 'delete') {
        const pitches = target.pitches.filter((p) => !pitchEquals(p, action.pitch));
        const events =
          pitches.length === 0
            ? m.events.filter((e) => e.id !== target.id)
            : m.events.map((e) => (e.id === target.id ? { ...target, pitches } : e));
        return withMeasureEvents(state, action.measureIndex, events);
      }

      // chord: add the new pitch, keeping the existing event's duration
      const pitches = sortPitches([...target.pitches, action.pitch]);
      const events = m.events.map((e) => (e.id === target.id ? { ...target, pitches } : e));
      return withMeasureEvents(state, action.measureIndex, events);
    }

    case 'CLICK_REST': {
      const m = state.measures[action.measureIndex];
      if (!m) return state;
      const total = measureTicks(effectiveTimeSignatureAt(state, action.measureIndex));
      const verdict = classifyRest(m.events, action.tick, action.duration, total, action.staff);
      if (verdict === 'blocked') return state;
      if (verdict === 'delete') {
        const target = m.events.find((e) => e.startTick === action.tick && e.staff === action.staff);
        if (!target) return state;
        return withMeasureEvents(state, action.measureIndex, m.events.filter((e) => e.id !== target.id));
      }
      const rest: RestEvent = { id: uid('r'), kind: 'rest', staff: action.staff, startTick: action.tick, duration: action.duration };
      return withMeasureEvents(state, action.measureIndex, [...m.events, rest]);
    }

    case 'SET_ACCIDENTAL': {
      const m = state.measures[action.measureIndex];
      if (!m) return state;
      const target = m.events.find((e) => e.id === action.eventId);
      if (!target || target.kind !== 'note') return state;
      let changed = false;
      const pitches = target.pitches.map((p) => {
        if (pitchToDiatonic(p) !== action.diatonic) return p;
        if (p.alter === action.alter && p.explicit) return p;
        changed = true;
        return { ...p, alter: action.alter, explicit: true };
      });
      if (!changed) return state;
      const events = m.events.map((e) => (e.id === target.id ? { ...target, pitches } : e));
      return withMeasureEvents(state, action.measureIndex, events);
    }

    case 'SET_DOTS': {
      const m = state.measures[action.measureIndex];
      if (!m) return state;
      const target = m.events.find((e) => e.id === action.eventId);
      if (!target || target.kind !== 'note') return state;
      // toggle: clicking the same dot count again removes the dots
      const newDots = target.duration.dots === action.dots ? 0 : action.dots;
      if (newDots === target.duration.dots) return state;
      const total = measureTicks(effectiveTimeSignatureAt(state, action.measureIndex));
      const oldDur = eventTicks(target);
      const newDuration = { ...target.duration, dots: newDots as 0 | 1 | 2 };
      const delta = eventTicks({ duration: newDuration, tuplet: target.tuplet }) - oldDur;
      // same-staff events after this one ripple to keep the rhythm contiguous
      const later = m.events.filter((e) => e.staff === target.staff && e.startTick > target.startTick);
      if (delta > 0) {
        const lastEnd = later.reduce((mx, e) => Math.max(mx, e.startTick + eventTicks(e)), target.startTick + oldDur);
        if (lastEnd + delta > total) return state; // no room for the longer note
      }
      const events = m.events.map((e) => {
        if (e.id === target.id) return { ...target, duration: newDuration };
        if (e.staff === target.staff && e.startTick > target.startTick) return { ...e, startTick: Math.max(0, e.startTick + delta) };
        return e;
      });
      return withMeasureEvents(state, action.measureIndex, events);
    }

    case 'MAKE_TUPLET': {
      const m = state.measures[action.measureIndex];
      if (!m) return state;
      const target = m.events.find((e) => e.id === action.eventId);
      if (!target || target.kind !== 'note' || target.tuplet) return state;
      const V = target.duration.value;
      if (V >= 32) return state; // a 32nd can't be split into a (non-existent) 64th triplet
      const memberDur: Duration = { value: (V * 2) as DurationValue, dots: 0 };
      const tuplet: Tuplet = { id: uid('tp'), actual: 3, normal: 2 };
      const memberTicks = eventTicks({ duration: memberDur, tuplet });
      const delta = 3 * memberTicks - eventTicks(target); // <= 0 (a dotted note shrinks to its base span)
      const members: NoteEvent[] = [0, 1, 2].map((k) => ({
        id: uid('n'),
        kind: 'note',
        staff: target.staff,
        startTick: target.startTick + k * memberTicks,
        duration: memberDur,
        tuplet,
        pitches: target.pitches.map((p) => ({ ...p })),
      }));
      const events = m.events
        .filter((e) => e.id !== target.id)
        .map((e) => (e.staff === target.staff && e.startTick > target.startTick ? { ...e, startTick: Math.max(0, e.startTick + delta) } : e))
        .concat(members);
      return withMeasureEvents(state, action.measureIndex, events);
    }

    case 'ERASE': {
      const m = state.measures[action.measureIndex];
      if (!m) return state;
      const target = m.events.find((e) => e.id === action.eventId);
      if (!target) return state;

      // Erasing a single notehead of a chord removes only that pitch; the last
      // pitch (or any rest) removes the whole event. Erasing any member of a
      // tuplet removes the whole tuplet group (so no fractional gap remains).
      if (target.kind === 'note' && action.diatonic !== null && !target.tuplet) {
        const pitches = target.pitches.filter((p) => pitchToDiatonic(p) !== action.diatonic);
        if (pitches.length === target.pitches.length) return state; // nothing matched
        const events =
          pitches.length === 0
            ? m.events.filter((e) => e.id !== target.id)
            : m.events.map((e) => (e.id === target.id ? { ...target, pitches } : e));
        return withMeasureEvents(state, action.measureIndex, events);
      }
      const drop = target.tuplet ? expandTupletIds(m.events, new Set([target.id])) : new Set([target.id]);
      return withMeasureEvents(state, action.measureIndex, m.events.filter((e) => !drop.has(e.id)));
    }

    case 'DELETE_MEASURES': {
      const drop = new Set(action.indices);
      let measures = state.measures.filter((_, i) => !drop.has(i));
      if (measures.length === 0) measures = [emptyMeasure()];
      return { ...state, measures };
    }

    case 'DELETE_NOTES': {
      const sel = new Set(action.ids);
      const measures = state.measures.map((m) => {
        if (!m.events.some((e) => sel.has(e.id))) return m;
        // deleting any member of a tuplet deletes the whole group
        const ids = expandTupletIds(m.events, sel);
        // Ripple per staff: removing a note shifts the later notes of the SAME
        // staff back by the deleted durations (the other staff is untouched).
        const kept: ScoreEvent[] = [];
        for (const staff of ['treble', 'bass'] as Staff[]) {
          const se = m.events.filter((e) => e.staff === staff);
          const deleted = se.filter((e) => ids.has(e.id));
          for (const e of se) {
            if (ids.has(e.id)) continue;
            const shift = deleted
              .filter((d) => d.startTick < e.startTick)
              .reduce((a, d) => a + eventTicks(d), 0);
            kept.push(shift > 0 ? { ...e, startTick: Math.max(0, e.startTick - shift) } : e);
          }
        }
        return { ...m, events: sortEvents(kept) };
      });
      return { ...state, measures };
    }

    case 'TRANSPOSE_NOTES': {
      if (action.delta === 0) return state;
      const ids = new Set(action.ids);
      const measures = state.measures.map((m) => {
        if (!m.events.some((e) => ids.has(e.id))) return m;
        const events = m.events.map((e) =>
          e.kind === 'note' && ids.has(e.id)
            ? { ...e, pitches: e.pitches.map((p) => diatonicToPitch(pitchToDiatonic(p) + action.delta, p.alter)) }
            : e,
        );
        return { ...m, events };
      });
      return { ...state, measures };
    }

    case 'MOVE_NOTE': {
      const m = state.measures[action.measureIndex];
      if (!m || action.fromDiatonic === action.toDiatonic) return state;
      const target = m.events.find((e) => e.id === action.eventId);
      if (!target || target.kind !== 'note') return state;
      // don't move onto another notehead already present in the chord
      if (target.pitches.some((p) => pitchToDiatonic(p) === action.toDiatonic)) return state;
      let moved = false;
      const pitches = sortPitches(
        target.pitches.map((p) =>
          pitchToDiatonic(p) === action.fromDiatonic ? ((moved = true), diatonicToPitch(action.toDiatonic, 0)) : p,
        ),
      );
      if (!moved) return state;
      const events = m.events.map((e) => (e.id === target.id ? { ...target, pitches } : e));
      return withMeasureEvents(state, action.measureIndex, events);
    }

    case 'PASTE_NOTES': {
      if (action.events.length === 0) return state;
      // map a global tick to its measure, extending past the end with the
      // trailing time signature so per-measure lengths are respected
      const meta = scoreMeta(state);
      const tailTs = meta.measures.length ? meta.measures[meta.measures.length - 1].ts : state.timeSignature;
      const tailTotal = measureTicks(tailTs);
      const locate = (g: number): { mi: number; local: number } => {
        for (const mm of meta.measures) if (g < mm.startTick + mm.total) return { mi: mm.index, local: g - mm.startTick };
        const last = meta.measures[meta.measures.length - 1];
        const base = last ? last.startTick + last.total : 0;
        const nextIdx = last ? last.index + 1 : 0;
        const extra = Math.floor((g - base) / tailTotal);
        return { mi: nextIdx + extra, local: g - (base + extra * tailTotal) };
      };
      // group pasted notes by target measure, preserving their relative offsets
      type Item = { tick: number; staff: Staff; duration: Duration; pitches: Pitch[]; tuplet?: Tuplet };
      const groups = new Map<number, Item[]>();
      for (const ev of action.events) {
        const g = action.baseTick + ev.offset;
        if (g < 0) continue;
        const { mi, local } = locate(g);
        const list = groups.get(mi) ?? [];
        list.push({ tick: local, staff: ev.staff, duration: ev.duration, pitches: ev.pitches, tuplet: ev.tuplet });
        groups.set(mi, list);
      }
      if (groups.size === 0) return state;
      const measures = state.measures.slice();
      const maxMi = Math.max(...groups.keys());
      while (measures.length <= maxMi) measures.push(emptyMeasure());
      for (const [mi, items] of groups) {
        let events = measures[mi].events;
        // shift existing notes right, per staff, to make room
        for (const staff of ['treble', 'bass'] as Staff[]) {
          const staffItems = items.filter((i) => i.staff === staff);
          if (staffItems.length === 0) continue;
          const minT = Math.min(...staffItems.map((i) => i.tick));
          const span = Math.max(...staffItems.map((i) => i.tick + eventTicks(i))) - minT;
          events = events.map((e) =>
            e.staff === staff && e.startTick >= minT ? { ...e, startTick: e.startTick + span } : e,
          );
        }
        const pasted: NoteEvent[] = items.map((it) => ({
          id: uid('n'),
          kind: 'note',
          staff: it.staff,
          startTick: it.tick,
          duration: it.duration,
          ...(it.tuplet ? { tuplet: it.tuplet } : {}),
          pitches: it.pitches.map((p) => ({ ...p })),
        }));
        measures[mi] = { ...measures[mi], events: sortEvents([...events, ...pasted]) };
      }
      return { ...state, measures };
    }

    case 'PASTE_MEASURES': {
      const fresh = action.measures.map((m) => ({
        ...m,
        id: uid('m'),
        events: m.events.map((e) => ({ ...e, id: uid('e') })),
      }));
      const measures = state.measures.slice();
      measures.splice(Math.max(0, Math.min(action.index, measures.length)), 0, ...fresh);
      return { ...state, measures };
    }

    case 'SET_TIME_SIGNATURE_AT': {
      const m = state.measures[action.measureIndex];
      if (!m) return state;
      const measures = state.measures.slice();
      measures[action.measureIndex] = { ...m, timeSignature: action.timeSignature };
      // trim events that no longer fit in any measure whose effective length shrank
      const meta = scoreMeta({ ...state, measures });
      const trimmed = measures.map((mm, i) => {
        const total = meta.measures[i].total;
        const events = mm.events.filter((e) => e.startTick + eventTicks(e) <= total);
        return events.length === mm.events.length ? mm : { ...mm, events };
      });
      return { ...state, measures: trimmed };
    }

    case 'SET_KEY_SIGNATURE_AT': {
      const m = state.measures[action.measureIndex];
      if (!m) return state;
      const measures = state.measures.slice();
      measures[action.measureIndex] = { ...m, keySignature: Math.max(-7, Math.min(7, action.keySignature)) };
      return { ...state, measures };
    }

    case 'SET_PICKUP': {
      const has = !!state.measures[0]?.pickup;
      if (action.on && !has) {
        // insert an empty anacrusis before the first measure
        return { ...state, measures: [{ id: uid('m'), events: [], pickup: true }, ...state.measures] };
      }
      if (!action.on && has) {
        const rest = state.measures.slice(1);
        return { ...state, measures: rest.length ? rest : [emptyMeasure()] };
      }
      return state;
    }

    case 'ADD_MEASURE':
      return { ...state, measures: [...state.measures, emptyMeasure()] };

    case 'REMOVE_LAST_MEASURE':
      return state.measures.length > 1 ? { ...state, measures: state.measures.slice(0, -1) } : state;

    case 'CLEAR':
      return { ...state, measures: state.measures.map(() => emptyMeasure()) };

    case 'LOAD':
      return action.score;

    default:
      return state;
  }
}
