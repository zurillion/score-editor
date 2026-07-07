import { Alter, ChordSymbol, Clef, Duration, DurationValue, Measure, NoteEvent, Pitch, RestEvent, ScoreEvent, Staff, StaffDef, ScoreState, TimeSignature, Tuplet } from '../music/types';
import { diatonicToPitch, durationTicks, eventTicks, measureTicks, pitchToDiatonic } from '../music/theory';
import { effectiveTimeSignatureAt, scoreMeta } from '../music/meta';
import { classifyNote, classifyRest, samePitch } from '../music/placement';
import { defaultStaves, newGroupId, newStaffId, sanitizeStaves, scoreStaves } from '../music/staves';
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
    staves: defaultStaves(),
    measures: Array.from({ length: measureCount }, emptyMeasure),
  };
}

/**
 * Fresh, unique ids for every measure/event of a loaded score. Stored files can
 * carry duplicate ids (e.g. a section duplicated, then edited after the in-memory
 * id counter reset on reload): duplicates make id-based operations — selection,
 * copy, tie/arpeggio grouping — act on the wrong event. Ids are internal (ties,
 * chords and repeats are resolved by position, not id), so re-keying is safe.
 */
function reidentify(measures: Measure[]): Measure[] {
  const tupletMap = new Map<string, string>();
  return measures.map((m) => ({
    ...m,
    id: uid('m'),
    events: m.events.map((e) => {
      const ev: ScoreEvent = { ...e, id: uid(e.kind === 'note' ? 'n' : 'r') };
      if (e.tuplet) {
        let nt = tupletMap.get(e.tuplet.id);
        if (!nt) {
          nt = uid('tp');
          tupletMap.set(e.tuplet.id, nt);
        }
        ev.tuplet = { ...e.tuplet, id: nt };
      }
      return ev;
    }),
  }));
}

/** Distinct staff ids among a measure's events (for per-staff ripples). */
function eventStaves(events: ScoreEvent[]): Staff[] {
  const ids: Staff[] = [];
  for (const e of events) if (!ids.includes(e.staff)) ids.push(e.staff);
  return ids;
}

export type ScoreAction =
  | { type: 'CLICK_NOTE'; measureIndex: number; tick: number; pitch: Pitch; duration: Duration; staff: Staff }
  | { type: 'CLICK_REST'; measureIndex: number; tick: number; duration: Duration; staff: Staff }
  | { type: 'SET_ACCIDENTAL'; measureIndex: number; eventId: string; diatonic: number; alter: Alter }
  | { type: 'SET_DOTS'; measureIndex: number; eventId: string; dots: 1 | 2 }
  | { type: 'MAKE_TUPLET'; measureIndex: number; eventId: string }
  | { type: 'TOGGLE_TIE'; measureIndex: number; eventId: string }
  | { type: 'SET_ARPEGGIO'; measureIndex: number; eventIds: string[]; on: boolean }
  | { type: 'TOGGLE_STACCATO'; measureIndex: number; eventId: string }
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
  | { type: 'SET_CHORD'; index: number; tick: number; text: string } // empty text removes the chord at that tick
  | { type: 'SET_REPEAT'; index: number; edge: 'start' | 'end'; on: boolean }
  | { type: 'SET_REPEAT_TIMES'; index: number; times: number } // coalesced (set by the count drag)
  | { type: 'ADD_STAFF'; where: 'above' | 'below'; clef: Clef; grand?: boolean } // a new staff (or grand pair) at the top/bottom
  | { type: 'REMOVE_STAFF'; id: Staff } // drops the staff and every event on it
  | { type: 'UPDATE_STAFF'; id: Staff; patch: Partial<Pick<StaffDef, 'clef' | 'key' | 'hidden' | 'name'>> }
  | { type: 'REORDER_STAVES'; order: Staff[] } // permutation of the staff ids (grand pairs stay adjacent)
  | { type: 'ADD_MEASURE' }
  | { type: 'REMOVE_LAST_MEASURE' }
  | { type: 'CLEAR' }
  | { type: 'LOAD'; score: ScoreState }
  | { type: 'UNDO' } // handled by the history wrapper
  | { type: 'COMMIT' }; // close the current coalescing group (e.g. end of a drag)

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
      const staff = action.staff;
      const verdict = classifyNote(m.events, action.tick, action.pitch, action.duration, total, staff);
      if (verdict === 'blocked') return state;

      const newTicks = durationTicks(action.duration);
      // a placed/grown note eats the (non-tuplet) rest span it now covers; the
      // leftover of a partially eaten rest re-derives automatically as rests
      const eatRests = (events: ScoreEvent[], keepId: string): ScoreEvent[] =>
        events.filter(
          (e) => e.id === keepId || e.staff !== staff || e.kind !== 'rest' || e.tuplet || action.tick >= e.startTick + eventTicks(e) || e.startTick >= action.tick + newTicks,
        );

      if (verdict === 'create') {
        // clicking a tuplet rest turns it back into a note (keeping the tuplet + slot)
        const restSlot = m.events.find((e) => e.startTick === action.tick && e.staff === staff && e.kind === 'rest' && e.tuplet);
        if (restSlot) {
          const note: NoteEvent = { id: uid('n'), kind: 'note', staff, startTick: action.tick, duration: restSlot.duration, tuplet: restSlot.tuplet, pitches: [action.pitch] };
          return withMeasureEvents(state, action.measureIndex, m.events.map((e) => (e.id === restSlot.id ? note : e)));
        }
        const note: NoteEvent = {
          id: uid('n'),
          kind: 'note',
          staff,
          startTick: action.tick,
          duration: action.duration,
          pitches: [action.pitch],
        };
        return withMeasureEvents(state, action.measureIndex, [...eatRests(m.events, ''), note]);
      }

      // resize / chord / delete operate on the event of this staff that starts exactly here
      const target = m.events.find((e) => e.startTick === action.tick && e.staff === staff);
      if (!target) return state;

      if (verdict === 'resize') {
        // a rest becomes a note of the chosen value; a note keeps its pitches but
        // changes value. Growing eats the rests to the right; shrinking frees space
        // that re-derives as rests.
        const next =
          target.kind === 'rest'
            ? m.events.map((e) => (e.id === target.id ? ({ id: uid('n'), kind: 'note', staff, startTick: action.tick, duration: action.duration, pitches: [action.pitch] } as NoteEvent) : e))
            : m.events.map((e) => (e.id === target.id ? { ...target, duration: action.duration } : e));
        return withMeasureEvents(state, action.measureIndex, eatRests(next, target.id));
      }

      if (target.kind !== 'note') return state;

      if (verdict === 'delete') {
        const pitches = target.pitches.filter((p) => !samePitch(p, action.pitch));
        let events: ScoreEvent[];
        if (pitches.length > 0) {
          events = m.events.map((e) => (e.id === target.id ? { ...target, pitches } : e));
        } else if (target.tuplet) {
          // removing the last pitch of a tuplet note leaves a tuplet rest (keeps the triplet intact)
          const rest: RestEvent = { id: uid('r'), kind: 'rest', staff: target.staff, startTick: target.startTick, duration: target.duration, tuplet: target.tuplet };
          events = m.events.map((e) => (e.id === target.id ? rest : e));
        } else {
          events = m.events.filter((e) => e.id !== target.id);
        }
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
        if (target.kind === 'note') {
          // a note of the same value is silenced: the rest takes its place
          const rest: RestEvent = { id: uid('r'), kind: 'rest', staff: action.staff, startTick: action.tick, duration: action.duration };
          return withMeasureEvents(state, action.measureIndex, m.events.map((e) => (e.id === target.id ? rest : e)));
        }
        // removing a tuplet rest clears the whole tuplet group (no fractional gap left behind)
        const drop = target.tuplet ? expandTupletIds(m.events, new Set([target.id])) : new Set([target.id]);
        return withMeasureEvents(state, action.measureIndex, m.events.filter((e) => !drop.has(e.id)));
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

    case 'TOGGLE_TIE': {
      const m = state.measures[action.measureIndex];
      if (!m) return state;
      const target = m.events.find((e) => e.id === action.eventId);
      if (!target || target.kind !== 'note') return state;
      const events = m.events.map((e) => (e.id === target.id ? { ...target, tieToNext: !target.tieToNext } : e));
      return withMeasureEvents(state, action.measureIndex, events);
    }

    case 'TOGGLE_STACCATO': {
      const m = state.measures[action.measureIndex];
      if (!m) return state;
      const target = m.events.find((e) => e.id === action.eventId);
      if (!target || target.kind !== 'note') return state;
      const { staccato: _drop, ...bare } = target;
      const events = m.events.map((e) => (e.id === target.id ? (target.staccato ? bare : { ...target, staccato: true }) : e));
      return withMeasureEvents(state, action.measureIndex, events);
    }

    case 'SET_ARPEGGIO': {
      const m = state.measures[action.measureIndex];
      if (!m) return state;
      const ids = new Set(action.eventIds);
      let changed = false;
      const events = m.events.map((e) => {
        if (e.kind !== 'note' || !ids.has(e.id) || !!e.arpeggio === action.on) return e;
        changed = true;
        const { arpeggio: _drop, ...bare } = e;
        return action.on ? { ...e, arpeggio: true } : bare;
      });
      if (!changed) return state;
      return withMeasureEvents(state, action.measureIndex, events);
    }

    case 'ERASE': {
      const m = state.measures[action.measureIndex];
      if (!m) return state;
      const target = m.events.find((e) => e.id === action.eventId);
      if (!target) return state;

      // A tuplet note turns into a tuplet rest (the triplet stays intact), like in
      // standard notation; a tuplet rest erased removes the whole group.
      const toTupletRest = (n: NoteEvent): RestEvent => ({ id: uid('r'), kind: 'rest', staff: n.staff, startTick: n.startTick, duration: n.duration, tuplet: n.tuplet });

      if (target.kind === 'note' && action.diatonic !== null) {
        const pitches = target.pitches.filter((p) => pitchToDiatonic(p) !== action.diatonic);
        if (pitches.length === target.pitches.length) return state; // nothing matched
        if (pitches.length > 0) {
          return withMeasureEvents(state, action.measureIndex, m.events.map((e) => (e.id === target.id ? { ...target, pitches } : e)));
        }
        // last pitch removed
        const replaced = target.tuplet ? toTupletRest(target) : null;
        const events = replaced
          ? m.events.map((e) => (e.id === target.id ? replaced : e))
          : m.events.filter((e) => e.id !== target.id);
        return withMeasureEvents(state, action.measureIndex, events);
      }
      if (target.kind === 'note' && target.tuplet) {
        return withMeasureEvents(state, action.measureIndex, m.events.map((e) => (e.id === target.id ? toTupletRest(target) : e)));
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
        // staff back by the deleted durations (other staves are untouched).
        const kept: ScoreEvent[] = [];
        for (const staff of eventStaves(m.events)) {
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
      type Item = { tick: number; staff: Staff; duration: Duration; pitches: Pitch[]; tuplet?: Tuplet; tieToNext?: boolean; staccato?: boolean; arpeggio?: boolean };
      const groups = new Map<number, Item[]>();
      const validStaves = new Set(scoreStaves(state).map((s) => s.id));
      for (const ev of action.events) {
        const g = action.baseTick + ev.offset;
        if (g < 0 || !validStaves.has(ev.staff)) continue; // the staff was removed since the copy
        const { mi, local } = locate(g);
        const list = groups.get(mi) ?? [];
        list.push({ tick: local, staff: ev.staff, duration: ev.duration, pitches: ev.pitches, tuplet: ev.tuplet, tieToNext: ev.tieToNext, staccato: ev.staccato, arpeggio: ev.arpeggio });
        groups.set(mi, list);
      }
      if (groups.size === 0) return state;
      // give every pasted tuplet a fresh id (so copies don't merge with the
      // original or with each other), preserving grouping within this paste
      const tupletRemap = new Map<string, Tuplet>();
      const remapTuplet = (t?: Tuplet): Tuplet | undefined => {
        if (!t) return undefined;
        let nt = tupletRemap.get(t.id);
        if (!nt) {
          nt = { ...t, id: uid('tp') };
          tupletRemap.set(t.id, nt);
        }
        return nt;
      };
      const measures = state.measures.slice();
      const maxMi = Math.max(...groups.keys());
      while (measures.length <= maxMi) measures.push(emptyMeasure());
      for (const [mi, items] of groups) {
        let events = measures[mi].events;
        // shift existing notes right, per staff, to make room
        for (const staff of [...new Set(items.map((i) => i.staff))]) {
          const staffItems = items.filter((i) => i.staff === staff);
          if (staffItems.length === 0) continue;
          const minT = Math.min(...staffItems.map((i) => i.tick));
          const span = Math.max(...staffItems.map((i) => i.tick + eventTicks(i))) - minT;
          events = events.map((e) =>
            e.staff === staff && e.startTick >= minT ? { ...e, startTick: e.startTick + span } : e,
          );
        }
        const pasted: NoteEvent[] = items.map((it) => {
          const tup = remapTuplet(it.tuplet);
          return {
            id: uid('n'),
            kind: 'note',
            staff: it.staff,
            startTick: it.tick,
            duration: it.duration,
            ...(tup ? { tuplet: tup } : {}),
            ...(it.tieToNext ? { tieToNext: true } : {}),
            ...(it.staccato ? { staccato: true } : {}),
            ...(it.arpeggio ? { arpeggio: true } : {}),
            pitches: it.pitches.map((p) => ({ ...p })),
          };
        });
        measures[mi] = { ...measures[mi], events: sortEvents([...events, ...pasted]) };
      }
      // Cascade the overflow: events pushed past a measure's capacity spill
      // into the next measure (created if missing), shifting its content
      // right in turn — so repeated pastes flow across barlines instead of
      // squeezing a fifth quarter into a 4/4 bar.
      const capacityOf = (i: number): number =>
        i < meta.measures.length ? meta.measures[i].capacityTicks : tailTotal;
      for (let i = 0; i < measures.length; i++) {
        const cap = capacityOf(i);
        if (cap <= 0) continue;
        for (const staff of eventStaves(measures[i].events)) {
          const over = measures[i].events.filter((e) => e.staff === staff && e.startTick + eventTicks(e) > cap);
          if (over.length === 0) continue;
          if (i + 1 >= measures.length) measures.push(emptyMeasure());
          const moved = over.map((e) => ({ ...e, startTick: Math.max(0, e.startTick - cap) }));
          const span = Math.max(...moved.map((e) => e.startTick + eventTicks(e)));
          const overSet = new Set(over);
          const next = measures[i + 1];
          measures[i + 1] = {
            ...next,
            events: sortEvents([...next.events.map((e) => (e.staff === staff ? { ...e, startTick: e.startTick + span } : e)), ...moved]),
          };
          measures[i] = { ...measures[i], events: measures[i].events.filter((e) => !overSet.has(e)) };
        }
      }
      return { ...state, measures };
    }

    case 'PASTE_MEASURES': {
      const fresh = action.measures.map((m) => {
        // fresh tuplet ids per measure so pasted copies don't merge
        const remap = new Map<string, Tuplet>();
        const tupletOf = (t?: Tuplet): Tuplet | undefined => {
          if (!t) return undefined;
          let nt = remap.get(t.id);
          if (!nt) {
            nt = { ...t, id: uid('tp') };
            remap.set(t.id, nt);
          }
          return nt;
        };
        return {
          ...m,
          id: uid('m'),
          events: m.events.map((e) => {
            const tup = tupletOf(e.tuplet);
            return { ...e, id: uid('e'), ...(tup ? { tuplet: tup } : {}) };
          }),
        };
      });
      const measures = state.measures.slice();
      measures.splice(Math.max(0, Math.min(action.index, measures.length)), 0, ...fresh);
      return { ...state, measures };
    }

    case 'SET_TIME_SIGNATURE_AT': {
      const m = state.measures[action.measureIndex];
      if (!m) return state;
      const measures = state.measures.slice();
      measures[action.measureIndex] = { ...m, timeSignature: action.timeSignature };
      // trim events (and chord symbols) that no longer fit where the effective length shrank
      const meta = scoreMeta({ ...state, measures });
      const trimmed = measures.map((mm, i) => {
        const total = meta.measures[i].total;
        const events = mm.events.filter((e) => e.startTick + eventTicks(e) <= total);
        const chords = mm.chords?.filter((c) => c.tick < total);
        if (events.length === mm.events.length && (chords?.length ?? 0) === (mm.chords?.length ?? 0)) return mm;
        return { ...mm, events, ...(chords && chords.length ? { chords } : { chords: undefined }) };
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

    case 'SET_CHORD': {
      const m = state.measures[action.index];
      if (!m) return state;
      const text = action.text.trim();
      const cur = m.chords ?? [];
      const others = cur.filter((c) => c.tick !== action.tick);
      let chords: ChordSymbol[];
      if (!text) {
        if (others.length === cur.length) return state; // nothing to remove
        chords = others;
      } else {
        if (cur.find((c) => c.tick === action.tick)?.text === text) return state;
        chords = [...others, { tick: action.tick, text }].sort((a, b) => a.tick - b.tick);
      }
      const measures = state.measures.slice();
      const { chords: _drop, ...bare } = m;
      measures[action.index] = chords.length ? { ...m, chords } : bare;
      return { ...state, measures };
    }

    case 'SET_REPEAT': {
      const m = state.measures[action.index];
      if (!m) return state;
      const measures = state.measures.slice();
      if (action.edge === 'start') {
        if (action.on === !!m.repeatStart) return state;
        const { repeatStart: _drop, ...rest } = m;
        measures[action.index] = action.on ? { ...m, repeatStart: { times: 1 } } : rest;
      } else {
        if (action.on === !!m.repeatEnd) return state;
        const { repeatEnd: _drop, ...rest } = m;
        measures[action.index] = action.on ? { ...m, repeatEnd: true } : rest;
      }
      return { ...state, measures };
    }

    case 'SET_REPEAT_TIMES': {
      const m = state.measures[action.index];
      if (!m?.repeatStart) return state;
      const times = Math.max(0, Math.min(99, Math.round(action.times)));
      if (times === m.repeatStart.times) return state;
      const measures = state.measures.slice();
      measures[action.index] = { ...m, repeatStart: { times } };
      return { ...state, measures };
    }

    case 'ADD_STAFF': {
      const staves = scoreStaves(state).slice();
      const add: StaffDef[] = [];
      if (action.grand) {
        const group = newGroupId(staves);
        const id1 = newStaffId(staves);
        add.push({ id: id1, clef: 'treble', key: null, group });
        add.push({ id: newStaffId([...staves, add[0]]), clef: 'bass', key: null, group });
      } else {
        add.push({ id: newStaffId(staves), clef: action.clef, key: null });
      }
      const next = action.where === 'above' ? [...add, ...staves] : [...staves, ...add];
      return { ...state, staves: next };
    }

    case 'REMOVE_STAFF': {
      const staves = scoreStaves(state);
      if (staves.length <= 1 || !staves.some((s) => s.id === action.id)) return state;
      const next = staves.filter((s) => s.id !== action.id);
      // events on the removed staff go with it; later same-staff content is untouched
      const measures = state.measures.map((m) =>
        m.events.some((e) => e.staff === action.id) ? { ...m, events: m.events.filter((e) => e.staff !== action.id) } : m,
      );
      return { ...state, staves: next, measures };
    }

    case 'UPDATE_STAFF': {
      const staves = scoreStaves(state);
      const idx = staves.findIndex((s) => s.id === action.id);
      if (idx < 0) return state;
      // never hide the last visible staff
      if (action.patch.hidden && staves.every((s, i) => (i === idx ? true : !!s.hidden))) return state;
      const cur = staves[idx];
      const patched: StaffDef = { ...cur, ...action.patch };
      if (patched.hidden === false || patched.hidden === undefined) delete patched.hidden;
      if (JSON.stringify(patched) === JSON.stringify(cur)) return state;
      const next = staves.slice();
      next[idx] = patched;
      return { ...state, staves: next };
    }

    case 'REORDER_STAVES': {
      const staves = scoreStaves(state);
      const byId = new Map(staves.map((s) => [s.id, s]));
      if (action.order.length !== staves.length || new Set(action.order).size !== action.order.length) return state;
      const next: StaffDef[] = [];
      for (const id of action.order) {
        const def = byId.get(id);
        if (!def) return state; // not a permutation of the current staves
        next.push(def);
      }
      // the staves of a group must stay adjacent (they render as one unit)
      const seenGroups = new Set<string>();
      for (let i = 0; i < next.length; i++) {
        const g = next[i].group;
        if (!g) continue;
        if (seenGroups.has(g) && next[i - 1]?.group !== g) return state;
        seenGroups.add(g);
      }
      if (next.every((s, i) => s === staves[i])) return state;
      return { ...state, staves: next };
    }

    case 'ADD_MEASURE':
      return { ...state, measures: [...state.measures, emptyMeasure()] };

    case 'REMOVE_LAST_MEASURE':
      return state.measures.length > 1 ? { ...state, measures: state.measures.slice(0, -1) } : state;

    case 'CLEAR':
      return { ...state, measures: state.measures.map(() => emptyMeasure()) };

    case 'LOAD':
      // normalize the staff list (older files have none: the classic grand staff)
      // and re-key every measure/event so a file's duplicate ids can't corrupt editing
      return { ...action.score, staves: sanitizeStaves(action.score.staves) ?? defaultStaves(), measures: reidentify(action.score.measures) };

    default:
      return state;
  }
}

// ---- Undo history ----
// Wraps scoreReducer so that *every* action that actually changes the score is
// pushed onto an undo stack. Rapid same-target actions (a note drag) coalesce
// into a single undo step; a COMMIT closes the current group.

export interface HistoryState {
  present: ScoreState;
  past: ScoreState[];
  coalesce: string | null; // key of the in-progress coalescing group
}

export function initialHistory(measureCount = 4): HistoryState {
  return { present: initialScore(measureCount), past: [], coalesce: null };
}

const UNDO_LIMIT = 100;

/** Actions whose rapid repetition should collapse into one undo step. */
function coalesceKey(action: ScoreAction): string | null {
  if (action.type === 'MOVE_NOTE') return `move:${action.eventId}`;
  if (action.type === 'SET_REPEAT_TIMES') return `rpt:${action.index}`;
  return null;
}

export function historyReducer(state: HistoryState, action: ScoreAction): HistoryState {
  if (action.type === 'UNDO') {
    if (state.past.length === 0) return state;
    return { present: state.past[state.past.length - 1], past: state.past.slice(0, -1), coalesce: null };
  }
  if (action.type === 'COMMIT') {
    return state.coalesce === null ? state : { ...state, coalesce: null };
  }
  const next = scoreReducer(state.present, action);
  if (next === state.present) return state; // no-op: nothing to record
  const key = coalesceKey(action);
  const merge = key !== null && key === state.coalesce; // continue the current group
  return {
    present: next,
    past: merge ? state.past : [...state.past, state.present].slice(-UNDO_LIMIT),
    coalesce: key,
  };
}
