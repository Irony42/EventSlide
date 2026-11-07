/**
 * The glyph paths two components share, in the 16 by 16 box both draw in.
 *
 * A module of its own, and not an export of `StatusIcon.tsx`: `statusIcon.guard.test.ts` reads
 * an import of that component as "this file draws a status glyph", and the dismiss button is
 * not one.
 */

/** A cross: the danger tone's glyph and the dismiss button's. */
export const CROSS_PATH =
  'M4.2 3.1 8 6.9l3.8-3.8 1.1 1.1L9.1 8l3.8 3.8-1.1 1.1L8 9.1l-3.8 3.8-1.1-1.1L6.9 8 3.1 4.2z'
