import { Alter, Duration, Measure, NoteEvent, Pitch, RestEvent, ScoreEvent, ScoreState, TimeSignature } from '../music/types';
import { diatonicToPitch, durationTicks, measureTicks, pitchEquals, pitchToDiatonic } from '../music/theory';
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
    measures: Array.from({ length: measureCount }, emptyMeasure),
  };
}

export type ScoreAction =
  | { type: 'CLICK_NOTE'; measureIndex: number; tick: number; pitch: Pitch; duration: Duration }
  | { type: 'CLICK_REST'; measureIndex: number; tick: number; duration: Duration }
  | { type: 'SET_ACCIDENTAL'; measureIndex: number; eventId: string; diatonic: number; alter: Alter }
  | { type: 'ERASE'; measureIndex: number; eventId: string; diatonic: number | null }
  | { type: 'DELETE_MEASURES'; indices: number[] }
  | { type: 'DELETE_NOTES'; ids: string[] }
  | { type: 'TRANSPOSE_NOTES'; ids: string[]; delta: number }
  | { type: 'PASTE_NOTES'; baseTick: number; events: ClipNote[] }
  | { type: 'PASTE_MEASURES'; index: number; measures: Measure[] }
  | { type: 'SET_TIME_SIGNATURE'; timeSignature: TimeSignature }
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

export function scoreReducer(state: ScoreState, action: ScoreAction): ScoreState {
  switch (action.type) {
    case 'CLICK_NOTE': {
      const m = state.measures[action.measureIndex];
      if (!m) return state;
      const total = measureTicks(state.timeSignature);
      const verdict = classifyNote(m.events, action.tick, action.pitch, action.duration, total);
      if (verdict === 'blocked') return state;

      if (verdict === 'create') {
        const note: NoteEvent = {
          id: uid('n'),
          kind: 'note',
          startTick: action.tick,
          duration: action.duration,
          pitches: [action.pitch],
        };
        return withMeasureEvents(state, action.measureIndex, [...m.events, note]);
      }

      // chord / delete operate on the event that starts exactly here
      const target = m.events.find((e) => e.startTick === action.tick);
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
      const total = measureTicks(state.timeSignature);
      const verdict = classifyRest(m.events, action.tick, action.duration, total);
      if (verdict === 'blocked') return state;
      if (verdict === 'delete') {
        const target = m.events.find((e) => e.startTick === action.tick);
        if (!target) return state;
        return withMeasureEvents(state, action.measureIndex, m.events.filter((e) => e.id !== target.id));
      }
      const rest: RestEvent = { id: uid('r'), kind: 'rest', startTick: action.tick, duration: action.duration };
      return withMeasureEvents(state, action.measureIndex, [...m.events, rest]);
    }

    case 'SET_ACCIDENTAL': {
      const m = state.measures[action.measureIndex];
      if (!m) return state;
      const target = m.events.find((e) => e.id === action.eventId);
      if (!target || target.kind !== 'note') return state;
      let changed = false;
      const pitches = target.pitches.map((p) =>
        pitchToDiatonic(p) === action.diatonic && p.alter !== action.alter
          ? ((changed = true), { ...p, alter: action.alter })
          : p,
      );
      if (!changed) return state;
      const events = m.events.map((e) => (e.id === target.id ? { ...target, pitches } : e));
      return withMeasureEvents(state, action.measureIndex, events);
    }

    case 'ERASE': {
      const m = state.measures[action.measureIndex];
      if (!m) return state;
      const target = m.events.find((e) => e.id === action.eventId);
      if (!target) return state;

      // Erasing a single notehead of a chord removes only that pitch; the last
      // pitch (or any rest) removes the whole event.
      if (target.kind === 'note' && action.diatonic !== null) {
        const pitches = target.pitches.filter((p) => pitchToDiatonic(p) !== action.diatonic);
        if (pitches.length === target.pitches.length) return state; // nothing matched
        const events =
          pitches.length === 0
            ? m.events.filter((e) => e.id !== target.id)
            : m.events.map((e) => (e.id === target.id ? { ...target, pitches } : e));
        return withMeasureEvents(state, action.measureIndex, events);
      }
      return withMeasureEvents(state, action.measureIndex, m.events.filter((e) => e.id !== target.id));
    }

    case 'DELETE_MEASURES': {
      const drop = new Set(action.indices);
      let measures = state.measures.filter((_, i) => !drop.has(i));
      if (measures.length === 0) measures = [emptyMeasure()];
      return { ...state, measures };
    }

    case 'DELETE_NOTES': {
      const ids = new Set(action.ids);
      const measures = state.measures.map((m) => {
        const deleted = m.events.filter((e) => ids.has(e.id));
        if (deleted.length === 0) return m;
        // Remove the events and ripple the remaining ones back by the total
        // duration of the deleted events that started before them.
        const kept = m.events
          .filter((e) => !ids.has(e.id))
          .map((e) => {
            const shift = deleted
              .filter((d) => d.startTick < e.startTick)
              .reduce((a, d) => a + durationTicks(d.duration), 0);
            return shift > 0 ? { ...e, startTick: Math.max(0, e.startTick - shift) } : e;
          });
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

    case 'PASTE_NOTES': {
      if (action.events.length === 0) return state;
      const total = measureTicks(state.timeSignature);
      // group pasted notes by target measure, preserving their relative offsets
      const groups = new Map<number, { tick: number; duration: Duration; pitches: Pitch[] }[]>();
      for (const ev of action.events) {
        const g = action.baseTick + ev.offset;
        const mi = Math.floor(g / total);
        if (mi < 0) continue;
        const list = groups.get(mi) ?? [];
        list.push({ tick: g - mi * total, duration: ev.duration, pitches: ev.pitches });
        groups.set(mi, list);
      }
      if (groups.size === 0) return state;
      const measures = state.measures.slice();
      const maxMi = Math.max(...groups.keys());
      while (measures.length <= maxMi) measures.push(emptyMeasure());
      for (const [mi, items] of groups) {
        const minT = Math.min(...items.map((i) => i.tick));
        const span = Math.max(...items.map((i) => i.tick + durationTicks(i.duration))) - minT;
        const shifted = measures[mi].events.map((e) =>
          e.startTick >= minT ? { ...e, startTick: e.startTick + span } : e,
        );
        const pasted: NoteEvent[] = items.map((it) => ({
          id: uid('n'),
          kind: 'note',
          startTick: it.tick,
          duration: it.duration,
          pitches: it.pitches.map((p) => ({ ...p })),
        }));
        measures[mi] = { ...measures[mi], events: sortEvents([...shifted, ...pasted]) };
      }
      return { ...state, measures };
    }

    case 'PASTE_MEASURES': {
      const fresh = action.measures.map((m) => ({
        id: uid('m'),
        events: m.events.map((e) => ({ ...e, id: uid('e') })),
      }));
      const measures = state.measures.slice();
      measures.splice(Math.max(0, Math.min(action.index, measures.length)), 0, ...fresh);
      return { ...state, measures };
    }

    case 'SET_TIME_SIGNATURE': {
      const total = measureTicks(action.timeSignature);
      const measures = state.measures.map((m) => ({
        ...m,
        events: m.events.filter((e) => e.startTick + durationTicks(e.duration) <= total),
      }));
      return { ...state, timeSignature: action.timeSignature, measures };
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
