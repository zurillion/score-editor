import { Alter } from '../music/types';

/**
 * The currently active editing tool.
 *
 * `note` / `rest` are the placement tools (hover + click on the staff).
 * `accidental` / `eraser` are "modal" tools that act on existing notes:
 *  - a single click on their toolbar button arms them for one use (`sticky:false`),
 *    after which the tool reverts to `note`;
 *  - a double click makes them persistent (`sticky:true`) until clicked off.
 */
export type Tool =
  | { kind: 'note' }
  | { kind: 'rest' }
  | { kind: 'accidental'; alter: Alter; sticky: boolean }
  | { kind: 'eraser'; sticky: boolean };

export const NOTE_TOOL: Tool = { kind: 'note' };
