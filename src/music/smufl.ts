// SMuFL (Bravura) code points used by the renderer.
// Reference: https://www.smufl.org/  (glyphs live in the Unicode Private Use Area)
//
// We build the glyph strings from code points so the source stays plain ASCII.

const g = (code: number): string => String.fromCharCode(code);

export const SMUFL = {
  gClef: g(0xe050),
  fClef: g(0xe062),

  // Time-signature digits 0..9 (U+E080..U+E089)
  timeSigDigits: Array.from({ length: 10 }, (_, i) => g(0xe080 + i)),

  rests: {
    1: g(0xe4e3), // whole
    2: g(0xe4e4), // half
    4: g(0xe4e5), // quarter
    8: g(0xe4e6), // 8th
    16: g(0xe4e7), // 16th
    32: g(0xe4e8), // 32nd
  } as Record<number, string>,

  // Flags attach at the stem tip.
  flagsUp: { 8: g(0xe240), 16: g(0xe242), 32: g(0xe244) } as Record<number, string>,
  flagsDown: { 8: g(0xe241), 16: g(0xe243), 32: g(0xe245) } as Record<number, string>,

  accidentals: {
    '-2': g(0xe264), // double flat
    '-1': g(0xe260), // flat
    '0': g(0xe261), // natural
    '1': g(0xe262), // sharp
    '2': g(0xe263), // double sharp
  } as Record<string, string>,

  // Combined note glyphs (stem up) for the palette buttons.
  paletteNotes: {
    1: g(0xe1d2), // whole
    2: g(0xe1d3), // half
    4: g(0xe1d5), // quarter
    8: g(0xe1d7), // 8th
    16: g(0xe1d9), // 16th
    32: g(0xe1db), // 32nd
  } as Record<number, string>,

  augmentationDot: g(0xe1e7),
};

export function timeSigString(n: number): string {
  return String(n)
    .split('')
    .map((c) => SMUFL.timeSigDigits[Number(c)])
    .join('');
}
