import { Alter } from '../music/types';

/**
 * The currently active editing tool.
 *
 * `note` / `rest` are the placement tools (hover + click on the staff); the
 * active duration comes from the palette.
 * `accidental` / `eraser` act on existing notes (one-shot or persistent).
 * `dot` sets the augmentation dots of an existing note (one-shot or persistent).
 * `select-measures` / `select-notes` select content for copy/cut/delete.
 */
export type Tool =
  | { kind: 'note' }
  | { kind: 'rest' }
  | { kind: 'accidental'; alter: Alter; sticky: boolean }
  | { kind: 'eraser'; sticky: boolean }
  | { kind: 'dot'; dots: 1 | 2; sticky: boolean }
  | { kind: 'tuplet'; sticky: boolean } // click a note to turn it into a triplet
  | { kind: 'tie'; sticky: boolean } // click a note to tie it to the next note of the same pitch
  | { kind: 'repeat' } // click a measure half to add |: / :| ; drag a sign vertically to set the play count; double-click removes
  | { kind: 'select-measures' }
  | { kind: 'select-notes' };

export const NOTE_TOOL: Tool = { kind: 'note' };
