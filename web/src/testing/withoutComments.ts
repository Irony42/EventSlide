/**
 * Comments stripped before anything is looked for.
 *
 * For a test that reads code as text. A guard that looks for a spelling has to look at code
 * and not at prose: the module that replaced a spelling usually explains the old one in a
 * comment, and a sweep that counted the prose would be satisfied by deleting the explanation.
 * It was needed first by a sweep of the wall's modules: `WallLayouts.tsx` discusses how many `<img>`
 * elements a layout may hold and `SlideLayer.tsx` explains what happens to a `<video>` on the
 * outgoing layer, so a sweep that counted prose would put half the wall's modules in the wrong
 * category — and would be fixed by deleting the comment.
 *
 * `//` needs a boundary in front of it so that `https://` survives, and the block form needs
 * one for exactly the same reason — which the first version of this did not give it. An
 * `accept` attribute whose value ends in a slash-star reads as an opening comment to an
 * unanchored sweep, which then deletes everything up to the next closing pair anywhere in the
 * file. Measured on this tree rather than assumed: 646 bytes of `ClipComposer.tsx` (the
 * attribute is `video/` + star), and 1 225 bytes of a router module, where the opener was the
 * route string for the join catch-all. Whether the fault bites depends on what comes
 * later in the file, so it is invisible until the day somebody adds an element below it.
 * Requiring a boundary costs nothing: a real comment is preceded by a line start, whitespace,
 * or one of `{ ; ( ,`.
 *
 * **What it still gets wrong, and nothing in this tree trips it.** It is a pair of regular
 * expressions and not a tokenizer: a ` //` inside a string or template literal loses the rest
 * of its line, and so does a protocol-relative `url(//host/a.png)` in a stylesheet. A guard
 * built on it can therefore miss a spelling that shares a line with such a string — the
 * direction that hides a defect, which is why the guards that use it also assert that their
 * detector finds known positives.
 */
export const withoutComments = (source: string): string =>
  source.replace(/(^|[\s{;(,])\/\*[\s\S]*?\*\//g, '$1').replace(/(^|[\s(])\/\/[^\n]*/g, '$1')
