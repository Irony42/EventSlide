import type { WallLayout } from '../../lib/api/dto'

/**
 * Which layouts play a clip, and which show its poster frame.
 *
 * **The decision is not made here.** It is made in `src/domain/slideshow/wallLayout.ts`,
 * as `WallLayoutSpec.playsVideo`, beside `slotCount` and `crops` — it is a statement
 * about what a room and a projector can bear, and that is domain, not presentation. This
 * file is the client's copy of that one field, and it exists because the client is the
 * only place that can apply it.
 *
 * The reason it has to be a copy rather than a fetch is worth stating, because it looks
 * like an oversight and is not: **the wall response does not carry the layout the screen
 * is showing.** The layout belongs to the screen, not to the event — it is chosen in the
 * browser from `?layout=` and the `L` key, and `GET /wall` is `.strict()` and refuses the
 * parameter outright (docs/API.md §3). So the server cannot resolve `playsVideo` for us:
 * it does not know, and asking it to would mean giving the event a layout it does not
 * have. `WallLayouts.tsx` already mirrors `slotCount` for the same reason, and says so.
 *
 * What is different here is that the copy is **guarded**.
 * `src/interface/http/presenters/wallLayoutContract.test.ts` reads this file's table as
 * source, compares it against `wallLayoutSpec`, and fails naming the layout when the two
 * disagree — so the drift that `COLLAGE_CELLS` admits nothing can detect is detected for
 * this field. Rename `PLAYS_VIDEO` and that test says so rather than going quietly green.
 *
 * Nothing else in `web/src` may decide this. A `className` check, a `layout === 'collage'`
 * in a component, or a CSS rule hiding a `<video>` would each be the same rule written a
 * second time, in the place it is hardest to find.
 */
const PLAYS_VIDEO: Readonly<Record<WallLayout, boolean>> = {
  // A whole screen, one photo, never cropped. One decoder.
  spotlight: true,
  mosaic: false,
  polaroid: false,
  filmstrip: false,
  // Twelve slots. Twelve simultaneous decodes is not a slower wall, it is a stuttering
  // one, for eight hours, on a venue mini-PC that is also driving the projector.
  collage: false,
  // Two panes, neither cropped. Two decoders, which is the budget.
  split: true,
}

export const wallLayoutPlaysVideo = (layout: WallLayout): boolean => PLAYS_VIDEO[layout]
