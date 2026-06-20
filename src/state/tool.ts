import { Alter } from '../music/types';

/**
 * The currently active editing tool.
 *
 * `note` / `rest` are the placement tools (hover + click on the staff); the
 * active duration comes from the palette.
 * `accidental` / `eraser` act on existing notes (one-shot or persistent).
 * `select-measures` / `select-notes` select content for copy/cut/delete.
 */
export type Tool =
  | { kind: 'note' }
  | { kind: 'rest' }
  | { kind: 'accidental'; alter: Alter; sticky: boolean }
  | { kind: 'eraser'; sticky: boolean }
  | { kind: 'select-measures' }
  | { kind: 'select-notes' };

export const NOTE_TOOL: Tool = { kind: 'note' };
