import { expect } from 'vitest'

/**
 * The module pattern of a rendered QR code, so a test can assert **which link** is on
 * screen.
 *
 * `qrcode.react` puts the encoded value nowhere in the DOM: it emits a light-field rect
 * and then one `<path>` whose `d` is a deterministic function of the string. So the only
 * honest way to check the link is to read that path out and compare it against the path
 * the same component draws for a URL the test names. Without this, a test can only assert
 * that *a* QR is present — which is what let the wall build its join link from
 * `window.location.origin` for four releases, printing the projector's own address at
 * every event behind a reverse proxy (CLAUDE.md §9 trap 1).
 *
 * It is here rather than inline in one spec because two components draw this code — the
 * empty wall's invitation and the corner reminder — and the subtlety below is worth
 * getting wrong only once.
 *
 * **The last path, not the first.** The first is the light-field plate — a single
 * `M0,0 h{n}v{n}H0z` rect, which carries no information about the encoded value at all (its
 * `n` is the module count, so it moves only when the string changes QR *version*). Select
 * it and two different links compare equal, which is what the first run of the test below
 * said out loud.
 */
export const qrPatternOf = (root: ParentNode): string => {
  const paths = [...root.querySelectorAll('path')]
  const drawn = paths.at(-1)?.getAttribute('d') ?? ''
  // A real code, not an empty plate: a selector that stopped matching would otherwise make
  // every comparison built on this pass on two empty strings.
  expect(drawn.length).toBeGreaterThan(100)
  return drawn
}
