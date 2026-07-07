// MusicXML export/import for the multi-staff score model.
//
// Every row of the score (a single staff, or the two staves of a grand-staff
// group) becomes one MusicXML part; grand parts carry <staves>2. Export is
// lossless for everything the app can write: per-measure time/key signatures,
// per-staff keys (transposing staves), anacrusis (implicit measure), chords,
// dots, 3:2 tuplets, ties, explicit accidentals and repeat barlines
// (times="0" encodes the app's ∞ loop — legal per schema, foreign apps fall
// back to their default).
//
// Import targets our own exports: it walks note/backup/forward with the
// divisions in effect and silently ignores anything it doesn't understand
// (other voices' decorations, graces, unknown durations, extra staves).
import { Alter, Clef, Duration, DurationValue, Measure, NoteEvent, Pitch, RestEvent, ScoreEvent, Staff, StaffDef, ScoreState, TimeSignature, Tuplet } from './types';
import { durationTicks, eventTicks, tupletFactor } from './theory';
import { scoreMeta } from './meta';
import { measureRests } from './rests';
import { resolveTies } from './ties';
import { keyAlterForStep } from './key';
import { scoreStaves } from './staves';
import { TICKS_PER_QUARTER } from './constants';
import { pitchToDiatonic } from './theory';

const TYPE_OF_VALUE: Record<DurationValue, string> = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd' };
const VALUE_OF_TYPE: Record<string, DurationValue> = { whole: 1, half: 2, quarter: 4, eighth: 8, '16th': 16, '32nd': 32 };
const ACCIDENTAL_NAME: Record<string, string> = { '-2': 'flat-flat', '-1': 'flat', '0': 'natural', '1': 'sharp', '2': 'double-sharp' };

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** Rows exported as MusicXML parts: single staves, or grand pairs. */
function exportRows(staves: StaffDef[]): StaffDef[][] {
  const rows: StaffDef[][] = [];
  for (const def of staves) {
    const prev = rows[rows.length - 1];
    if (prev && def.group && prev[0].group === def.group && prev.length < 2) prev.push(def);
    else rows.push([def]);
  }
  return rows;
}

export function exportMusicXML(name: string, bpm: number, score: ScoreState): string {
  const meta = scoreMeta(score);
  const ties = resolveTies(score, meta);
  const tieStart = new Set(ties.map((t) => `${t.fromIndex}|${t.fromTick}|${t.staff}|${t.diatonic}`));
  const tieStop = new Set(ties.map((t) => `${t.toIndex}|${t.toTick}|${t.staff}|${t.diatonic}`));
  const staves = scoreStaves(score);
  const allStaffIds = staves.map((s) => s.id);
  const rows = exportRows(staves);

  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  const partName = (row: StaffDef[], k: number): string =>
    row[0].name ?? (row.length === 2 ? 'Piano' : `Rigo ${k + 1}`);

  push('<?xml version="1.0" encoding="UTF-8"?>');
  push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
  push('<score-partwise version="4.0">');
  push(`  <work><work-title>${esc(name || 'Brano senza titolo')}</work-title></work>`);
  push('  <identification><encoding><software>Score Composer</software></encoding></identification>');
  push('  <part-list>' + rows.map((row, k) => `<score-part id="P${k + 1}"><part-name>${esc(partName(row, k))}</part-name></score-part>`).join('') + '</part-list>');

  rows.forEach((row, k) => {
    push(`  <part id="P${k + 1}">`);
    const fixedKey = row[0].key; // a transposing part keeps its own constant key
    const clefXml = (clef: Clef, number: string) =>
      clef === 'bass'
        ? `<clef${number}><sign>F</sign><line>4</line></clef>`
        : clef === 'percussion'
          ? `<clef${number}><sign>percussion</sign></clef>`
          : `<clef${number}><sign>G</sign><line>2</line></clef>`;

    score.measures.forEach((m, mi) => {
      const mm = meta.measures[mi];
      const number = mm.pickup ? 0 : meta.measures.slice(0, mi).filter((x) => !x.pickup).length + 1;
      push(`    <measure number="${number}"${mm.pickup ? ' implicit="yes"' : ''}>`);

      // attributes: everything on the first measure, then only what changes
      const attrs: string[] = [];
      if (mi === 0) attrs.push(`<divisions>${TICKS_PER_QUARTER}</divisions>`);
      if (mi === 0) attrs.push(`<key><fifths>${fixedKey ?? mm.keySig}</fifths></key>`);
      else if (mm.keyChanged && fixedKey === null) attrs.push(`<key><fifths>${mm.keySig}</fifths></key>`);
      if (mi === 0 || mm.tsChanged) attrs.push(`<time><beats>${mm.ts.numerator}</beats><beat-type>${mm.ts.denominator}</beat-type></time>`);
      if (mi === 0) {
        if (row.length === 2) attrs.push('<staves>2</staves>', clefXml(row[0].clef, ' number="1"'), clefXml(row[1].clef, ' number="2"'));
        else attrs.push(clefXml(row[0].clef, ''));
      }
      if (attrs.length) push(`      <attributes>${attrs.join('')}</attributes>`);

      if (mi === 0 && k === 0) {
        push('      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>' + `${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>`);
      }

      if (m.repeatStart) push('      <barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>');

      // chord names: free-text words below the staves (first part only, so a
      // round-trip doesn't duplicate them)
      if (k === 0) {
        for (const c of m.chords ?? []) {
          push(
            `      <direction placement="below"><direction-type><words>${esc(c.text)}</words></direction-type>${c.tick ? `<offset>${c.tick}</offset>` : ''}</direction>`,
          );
        }
      }

      // per-staff timelines: stored events plus the derived filler rests
      // (a fully empty measure gets explicit whole-measure rests: notation
      // programs expect every staff's time to be accounted for)
      const derived = measureRests(m.events, mm.total, !mm.pickup, allStaffIds);
      const allEmpty = m.events.length === 0 && mm.total > 0;
      const timeline = (staff: Staff): (ScoreEvent | (RestEvent & { whole?: boolean }))[] => {
        const evs: (ScoreEvent | (RestEvent & { whole?: boolean }))[] = m.events.filter((e) => e.staff === staff);
        derived.filter((r) => r.staff === staff).forEach((r, i) => evs.push({ id: `dr${mi}-${staff}-${i}`, kind: 'rest', staff, startTick: r.startTick, duration: r.duration, whole: r.whole }));
        if (allEmpty) evs.push({ id: `dr${mi}-${staff}-w`, kind: 'rest', staff, startTick: 0, duration: { value: 1, dots: 0 }, whole: true });
        return evs.sort((a, b) => a.startTick - b.startTick);
      };

      // tuplet bracket boundaries (first/last member of each group)
      const tupletEdge = new Map<string, { first: string; last: string }>();
      for (const ev of m.events) {
        if (!ev.tuplet) continue;
        const cur = tupletEdge.get(ev.tuplet.id);
        if (!cur) tupletEdge.set(ev.tuplet.id, { first: ev.id, last: ev.id });
        else {
          const firstEv = m.events.find((e) => e.id === cur.first)!;
          const lastEv = m.events.find((e) => e.id === cur.last)!;
          if (ev.startTick < firstEv.startTick) cur.first = ev.id;
          if (ev.startTick > lastEv.startTick) cur.last = ev.id;
        }
      }

      const writeStaff = (staff: Staff, staffNo: 1 | 2, voice: number): number => {
        const staffEl = row.length === 2 ? `<staff>${staffNo}</staff>` : '';
        let advanced = 0;
        for (const ev of timeline(staff)) {
          const ticks = ev.kind === 'rest' && (ev as RestEvent & { whole?: boolean }).whole ? mm.total : eventTicks(ev);
          advanced = Math.max(advanced, ev.startTick + ticks);
          const typeEl = `<type>${TYPE_OF_VALUE[ev.duration.value]}</type>` + '<dot/>'.repeat(ev.duration.dots);
          const tm = ev.tuplet ? `<time-modification><actual-notes>${ev.tuplet.actual}</actual-notes><normal-notes>${ev.tuplet.normal}</normal-notes></time-modification>` : '';
          const edge = ev.tuplet ? tupletEdge.get(ev.tuplet.id) : undefined;
          const tupletNotation = edge ? (edge.first === ev.id ? '<tuplet type="start"/>' : '') + (edge.last === ev.id ? '<tuplet type="stop"/>' : '') : '';

          if (ev.kind === 'rest') {
            const whole = (ev as RestEvent & { whole?: boolean }).whole;
            push(
              `      <note><rest${whole ? ' measure="yes"' : ''}/><duration>${ticks}</duration><voice>${voice}</voice>${whole ? '' : typeEl}${tm}${staffEl}${tupletNotation ? `<notations>${tupletNotation}</notations>` : ''}</note>`,
            );
            continue;
          }
          ev.pitches.forEach((p, pi) => {
            const d = pitchToDiatonic(p);
            const starts = ev.tieToNext && tieStart.has(`${mi}|${ev.startTick}|${staff}|${d}`);
            const stops = tieStop.has(`${mi}|${ev.startTick}|${staff}|${d}`);
            const tieEls = (stops ? '<tie type="stop"/>' : '') + (starts ? '<tie type="start"/>' : '');
            const tied = (stops ? '<tied type="stop"/>' : '') + (starts ? '<tied type="start"/>' : '');
            const notations =
              tied + (ev.arpeggio ? '<arpeggiate/>' : '') + (pi === 0 ? (ev.staccato ? '<articulations><staccato/></articulations>' : '') + tupletNotation : '');
            push(
              '      <note>' +
                (pi > 0 ? '<chord/>' : '') +
                `<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>` +
                `<duration>${ticks}</duration>${tieEls}<voice>${voice}</voice>${typeEl}` +
                (p.explicit ? `<accidental>${ACCIDENTAL_NAME[String(p.alter)]}</accidental>` : '') +
                tm +
                staffEl +
                (notations ? `<notations>${notations}</notations>` : '') +
                '</note>',
            );
          });
        }
        return advanced;
      };

      const advanced = writeStaff(row[0].id, 1, 1);
      if (row.length === 2) {
        if (advanced > 0) push(`      <backup><duration>${advanced}</duration></backup>`);
        writeStaff(row[1].id, 2, 5);
      }

      if (m.repeatEnd) {
        // the play count lives on the matching start sign; ∞ (0) is written as times="0"
        let times: number | null = null;
        for (let i = mi; i >= 0; i--) {
          if (score.measures[i].repeatStart) {
            times = score.measures[i].repeatStart!.times;
            break;
          }
        }
        const timesAttr = times !== null ? ` times="${times}"` : '';
        push(`      <barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"${timesAttr}/></barline>`);
      }
      push('    </measure>');
    });

    push('  </part>');
  });
  push('</score-partwise>');
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportedPiece {
  name: string;
  bpm: number | null;
  score: ScoreState;
}

let importCounter = 0;
const iuid = (prefix: string): string => `${prefix}x${++importCounter}`;

const text = (el: Element | null | undefined, tag: string): string | null => el?.getElementsByTagName(tag)[0]?.textContent ?? null;
const num = (el: Element | null | undefined, tag: string): number | null => {
  const t = text(el, tag);
  if (t === null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** (value, dots) whose span matches `ticks` under the given tuplet ratio, or null. */
function durationFromTicks(ticks: number, tuplet?: Tuplet): Duration | null {
  for (const value of [1, 2, 4, 8, 16, 32] as DurationValue[]) {
    for (const dots of [0, 1, 2] as const) {
      if (Math.round(durationTicks({ value, dots }) * tupletFactor(tuplet)) === ticks) return { value, dots };
    }
  }
  return null;
}

export function importMusicXML(xml: string): ImportedPiece {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML non valido');
  const root = doc.getElementsByTagName('score-partwise')[0];
  if (!root) throw new Error('non è un file MusicXML score-partwise');
  const parts = Array.from(root.getElementsByTagName('part'));
  if (parts.length === 0) throw new Error('nessuna parte nel file');

  const name = text(root.getElementsByTagName('work')[0], 'work-title') ?? text(root, 'movement-title') ?? '';
  let bpm: number | null = null;
  let scoreKey: number | null = null;
  let scoreTs: TimeSignature | null = null;

  const measures: Measure[] = [];
  const staves: StaffDef[] = [];

  parts.forEach((part, pk) => {
    const isFirst = pk === 0;
    const mEls = Array.from(part.getElementsByTagName('measure'));
    if (mEls.length === 0) return;

    // pre-scan the part's first <attributes>: staff count, clefs and key
    const attrs0 = mEls[0].getElementsByTagName('attributes')[0];
    const staffCount = Math.max(1, Math.min(2, (attrs0 && num(attrs0, 'staves')) || 1));
    const clefs: Clef[] = ['treble', staffCount === 2 ? 'bass' : 'treble'];
    if (attrs0) {
      for (const clefEl of Array.from(attrs0.getElementsByTagName('clef'))) {
        const idx = Math.max(1, Math.min(2, Number(clefEl.getAttribute('number') ?? '1'))) - 1;
        if (text(clefEl, 'sign') === 'F') clefs[idx] = 'bass';
        else if (text(clefEl, 'sign') === 'percussion') clefs[idx] = 'percussion';
        else if (text(clefEl, 'sign') === 'G') clefs[idx] = 'treble';
      }
    }
    const keyEl0 = attrs0?.getElementsByTagName('key')[0];
    const partKey0 = keyEl0 ? num(keyEl0, 'fifths') : null;
    if (isFirst && partKey0 !== null && partKey0 >= -7 && partKey0 <= 7) scoreKey = partKey0;

    // staff ids: the first grand part keeps the classic ids so old files round-trip
    const ids: Staff[] =
      isFirst && staffCount === 2
        ? ['treble', 'bass']
        : staffCount === 2
          ? [`p${pk + 1}a`, `p${pk + 1}b`]
          : [`p${pk + 1}`];
    const group = staffCount === 2 ? (isFirst ? 'grand' : `g${pk + 1}`) : undefined;
    // a non-first part whose key differs from the score's is a transposing staff
    const fixedKey = !isFirst && partKey0 !== null && partKey0 !== (scoreKey ?? 0) && partKey0 >= -7 && partKey0 <= 7 ? partKey0 : null;
    ids.forEach((id, k) => staves.push({ id, clef: clefs[k], key: fixedKey, ...(group ? { group } : {}) }));

    let divisions = TICKS_PER_QUARTER;
    let curKey = partKey0 ?? scoreKey ?? 0;
    let curTs: TimeSignature = { numerator: 4, denominator: 4 };
    let sawKey = false;
    let sawTs = false;
    const toTicks = (d: number) => Math.round((d * TICKS_PER_QUARTER) / divisions);

    mEls.forEach((mEl, mi) => {
      // the first part creates the measures; the others fill into them
      while (measures.length <= mi) measures.push({ id: iuid('m'), events: [] });
      const measure = measures[mi];
      if (isFirst && mi === 0 && mEl.getAttribute('implicit') === 'yes') measure.pickup = true;

      let keyForMeasure = fixedKey ?? curKey; // effective key here (attributes below may update it)
      let pos = 0;
      let lastNote: NoteEvent | null = null; // <chord/> attaches here
      // raw per-note info collected for tuplet grouping / explicit flags
      const rawNotes: { ev: ScoreEvent; ratio: string | null; accidentals: boolean[] }[] = [];

      for (const el of Array.from(mEl.children)) {
        switch (el.tagName) {
          case 'attributes': {
            const div = num(el, 'divisions');
            if (div && div > 0) divisions = div;
            const keyEl = el.getElementsByTagName('key')[0];
            const fifths = keyEl ? num(keyEl, 'fifths') : null;
            if (fifths !== null && fifths >= -7 && fifths <= 7) {
              // measure-level key changes come from the first (score-key) part
              if (isFirst && sawKey && fifths !== curKey) measure.keySignature = fifths;
              sawKey = true;
              curKey = fifths;
              if (fixedKey === null) keyForMeasure = fifths;
            }
            const timeEl = el.getElementsByTagName('time')[0];
            const beats = timeEl ? num(timeEl, 'beats') : null;
            const beatType = timeEl ? num(timeEl, 'beat-type') : null;
            if (beats && beatType) {
              const ts = { numerator: beats, denominator: beatType };
              if (isFirst) {
                if (!sawTs) scoreTs = ts;
                else if (ts.numerator !== curTs.numerator || ts.denominator !== curTs.denominator) measure.timeSignature = ts;
              }
              sawTs = true;
              curTs = ts;
            }
            break;
          }
          case 'direction':
          case 'sound': {
            const soundEl = el.tagName === 'sound' ? el : el.getElementsByTagName('sound')[0];
            const tempo = soundEl?.getAttribute('tempo');
            if (bpm === null && tempo && Number.isFinite(Number(tempo))) bpm = Math.round(Number(tempo));
            if (!isFirst) break; // chords travel with the first part only
            // free text below the staff = a chord name (how our export writes them)
            const words = el.getElementsByTagName('words')[0]?.textContent?.trim();
            if (words && el.getAttribute('placement') === 'below') {
              const off = num(el, 'offset');
              const tick = Math.max(0, pos + (off ? toTicks(off) : 0));
              (measure.chords ??= []).push({ tick, text: words });
            }
            break;
          }
          case 'barline': {
            if (!isFirst) break; // repeats are measure-level: first part only
            const repeat = el.getElementsByTagName('repeat')[0];
            if (!repeat) break;
            if (repeat.getAttribute('direction') === 'forward') {
              measure.repeatStart = { times: 1 };
            } else if (repeat.getAttribute('direction') === 'backward') {
              measure.repeatEnd = true;
              const timesAttr = repeat.getAttribute('times');
              const times = timesAttr !== null && Number.isFinite(Number(timesAttr)) ? Math.max(0, Math.round(Number(timesAttr))) : null;
              // assign the count to the matching |: (this measure included)
              for (let i = mi; i >= 0; i--) {
                if (measures[i].repeatStart) {
                  measures[i].repeatStart = { times: times ?? 2 };
                  break;
                }
              }
            }
            break;
          }
          case 'backup': {
            const d = num(el, 'duration');
            if (d) pos = Math.max(0, pos - toTicks(d));
            break;
          }
          case 'forward': {
            const d = num(el, 'duration');
            if (d) pos += toTicks(d);
            break;
          }
          case 'note': {
            if (el.getElementsByTagName('grace').length) break; // no duration: ignore
            const durRaw = num(el, 'duration');
            if (!durRaw || durRaw <= 0) break;
            const ticks = toTicks(durRaw);
            const isChord = el.getElementsByTagName('chord').length > 0;
            const staffNo = num(el, 'staff') ?? 1;
            const staff: Staff = ids[Math.max(1, Math.min(ids.length, staffNo)) - 1];
            const restEl = el.getElementsByTagName('rest')[0];
            const pitchEl = el.getElementsByTagName('pitch')[0];

            // duration: prefer <type> + dots; fall back to the raw tick span
            const tmEl = el.getElementsByTagName('time-modification')[0];
            const actual = tmEl ? num(tmEl, 'actual-notes') : null;
            const normal = tmEl ? num(tmEl, 'normal-notes') : null;
            const ratio = actual && normal && actual !== normal ? `${actual}:${normal}` : null;
            const probeTuplet: Tuplet | undefined = ratio ? { id: 'probe', actual: actual!, normal: normal! } : undefined;
            const typeName = text(el, 'type');
            const dots = Math.min(2, el.getElementsByTagName('dot').length) as 0 | 1 | 2;
            let duration: Duration | null = typeName && VALUE_OF_TYPE[typeName] ? { value: VALUE_OF_TYPE[typeName], dots } : durationFromTicks(ticks, probeTuplet);

            if (restEl) {
              if (!isChord) pos += ticks;
              if (restEl.getAttribute('measure') === 'yes') break; // the app derives whole-measure rests itself
              if (!duration) break; // unknown span: ignore
              const rest: RestEvent = { id: iuid('r'), kind: 'rest', staff, startTick: pos - ticks, duration };
              rawNotes.push({ ev: rest, ratio, accidentals: [] });
              measure.events.push(rest);
              lastNote = null;
              break;
            }
            if (!pitchEl) {
              if (!isChord) pos += ticks;
              break;
            }
            const step = text(pitchEl, 'step');
            const octave = num(pitchEl, 'octave');
            const alterRaw = num(pitchEl, 'alter') ?? 0;
            const alter = Math.max(-2, Math.min(2, Math.round(alterRaw))) as Alter;
            const hasAccidental = el.getElementsByTagName('accidental').length > 0;
            if (!step || !'ABCDEFG'.includes(step) || octave === null || octave < 0 || octave > 9) {
              if (!isChord) pos += ticks;
              break;
            }
            const pitch: Pitch = { step: step as Pitch['step'], octave, alter };

            const arpeggiate = el.getElementsByTagName('arpeggiate').length > 0;
            if (isChord && lastNote && lastNote.staff === staff) {
              if (arpeggiate) lastNote.arpeggio = true;
              lastNote.pitches.push(pitch);
              lastNote.pitches.sort((a, b) => pitchToDiatonic(a) - pitchToDiatonic(b));
              const raw = rawNotes.find((r) => r.ev === lastNote);
              raw?.accidentals.push(hasAccidental);
              break;
            }
            if (!duration) {
              pos += ticks;
              break; // unknown duration: skip the note but keep time
            }
            const note: NoteEvent = { id: iuid('n'), kind: 'note', staff, startTick: pos, duration, pitches: [pitch] };
            if (el.getElementsByTagName('tie').length && Array.from(el.getElementsByTagName('tie')).some((t) => t.getAttribute('type') === 'start')) {
              note.tieToNext = true;
            }
            if (arpeggiate) note.arpeggio = true;
            if (el.getElementsByTagName('staccato').length > 0) note.staccato = true;
            pos += ticks;
            rawNotes.push({ ev: note, ratio, accidentals: [hasAccidental] });
            measure.events.push(note);
            lastNote = note;
            break;
          }
          default:
            break; // anything else: ignored by design
        }
      }

      // tuplets: contiguous same-ratio runs per staff become one group
      for (const staff of ids) {
        const run = rawNotes.filter((r) => r.ev.staff === staff).sort((a, b) => a.ev.startTick - b.ev.startTick);
        let group: Tuplet | null = null;
        let prevEnd = -1;
        let prevRatio: string | null = null;
        for (const r of run) {
          if (!r.ratio) {
            group = null;
            prevRatio = null;
            continue;
          }
          const [actual, normal] = r.ratio.split(':').map(Number);
          const contiguous = r.ev.startTick === prevEnd && r.ratio === prevRatio && group;
          if (!contiguous) group = { id: iuid('tp'), actual, normal };
          r.ev.tuplet = { ...group! };
          prevEnd = r.ev.startTick + eventTicks(r.ev);
          prevRatio = r.ratio;
        }
      }

      // explicit accidental flags: follow the measure's accidental state per staff
      for (const staff of ids) {
        const state = new Map<string, Alter>(); // "step|octave" -> alter in effect
        const run = rawNotes.filter((r) => r.ev.staff === staff && r.ev.kind === 'note').sort((a, b) => a.ev.startTick - b.ev.startTick);
        for (const r of run) {
          (r.ev as NoteEvent).pitches.forEach((p, pi) => {
            const k = `${p.step}|${p.octave}`;
            const effective = state.has(k) ? state.get(k)! : keyAlterForStep(p.step, keyForMeasure);
            if (r.accidentals[pi] || p.alter !== effective) {
              p.explicit = true;
              state.set(k, p.alter);
            }
          });
        }
      }

      measure.events.sort((a, b) => a.startTick - b.startTick);
      measure.chords?.sort((a, b) => a.tick - b.tick);
    });
  });

  if (measures.length === 0) throw new Error('nessuna battuta nel file');
  const score: ScoreState = {
    timeSignature: scoreTs ?? { numerator: 4, denominator: 4 },
    keySignature: scoreKey ?? 0,
    ...(staves.length ? { staves } : {}),
    measures,
  };
  return { name, bpm, score };
}
