// ---- Rhythm resolution ----
// Ticks per whole note. 768 is divisible by every common note value (down to
// the 32nd) as well as by 3, leaving room for future tuplets.
export const TICKS_PER_WHOLE = 768;
export const TICKS_PER_QUARTER = TICKS_PER_WHOLE / 4; // 192

// ---- Staff geometry (pixels) ----
export const STAFF_SPACE = 12; // distance between two adjacent staff lines
export const HALF_SPACE = STAFF_SPACE / 2;

// Vertical layout of one grand-staff ("endecalineo") system.
export const STAFF_TOP = 64; // y of the top treble line (F5, diatonic 38)
// Middle C is diatonic 28, i.e. 10 half-spaces below F5.
export const Y_MIDDLE_C = STAFF_TOP + (38 - 28) * HALF_SPACE;
export const SYSTEM_HEIGHT = 248; // total vertical space reserved per system
export const SYSTEM_GAP = 26; // vertical gap between systems in page mode

// ---- Horizontal layout (pixels) ----
export const HEADER_WIDTH = 104; // brace + clef + time-signature area
export const STAFF_LEFT = 14; // where the staff lines start
export const BRACE_X = 9;
export const CLEF_X = 24;
export const TIME_SIG_X = 80;
export const MEASURE_PAD = 18; // inner left/right padding inside a measure
export const PX_PER_TICK = 64 / TICKS_PER_QUARTER; // a quarter note ~ 64px wide

// ---- Note glyph geometry ----
export const NOTEHEAD_RX = 0.62 * STAFF_SPACE;
export const NOTEHEAD_RY = 0.5 * STAFF_SPACE;
export const WHOLE_RX = 0.9 * STAFF_SPACE;
export const STEM_WIDTH = 1.6;
export const STEM_LENGTH = 3.5 * STAFF_SPACE;
export const STAFF_LINE_WIDTH = 1.1;
export const LEDGER_WIDTH = 1.4;
export const LEDGER_HALF = 1.05 * STAFF_SPACE;
export const BAR_LINE_WIDTH = 1.2;

// SMuFL fonts are designed so that 1em == 4 staff spaces.
export const GLYPH_FONT_SIZE = 4 * STAFF_SPACE;
