import { Alter, Duration, Measure, NoteEvent, Pitch, ScoreEvent, ScoreState, TimeSignature } from '../music/types';
import { durationTicks, measureTicks, pitchEquals, pitchToDiatonic } from '../music/theory';
import { classifyNote } from '../music/placement';

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
  | { type: 'SET_ACCIDENTAL'; measureIndex: number; eventId: string; diatonic: number; alter: Alter }
  | { type: 'ERASE'; measureIndex: number; eventId: string; diatonic: number | null }
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
