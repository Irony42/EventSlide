/** The part of fontkit the book reads: whether a font has a glyph for a character. */
declare module 'fontkit' {
  export interface Font {
    hasGlyphForCodePoint(codePoint: number): boolean
  }
  export function openSync(path: string): Font
}
