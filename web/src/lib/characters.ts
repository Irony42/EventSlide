/**
 * Text length as the server counts it: in code points (`[...text].length`, the same count as
 * `characterCount` in `src/domain/shared/plainText.ts`), not in UTF-16 units.
 *
 * The HTML `maxLength` attribute counts UTF-16 units, so it would cut a flag or a family emoji
 * the server accepts, and a counter built on `.length` would say 2 for one emoji. Every web
 * input that mirrors a server text limit uses these two instead of `maxLength`.
 */
export const characterCount = (text: string): number => [...text].length

/** The first `max` characters of `text`, cut between code points, never inside one. */
export const clampCharacters = (text: string, max: number): string => {
  const characters = [...text]
  return characters.length <= max ? text : characters.slice(0, max).join('')
}
