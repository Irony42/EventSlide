import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { openSync, type Font } from 'fontkit'
import type { BookStyleDef } from '../../../domain/book/bookStyles'

/**
 * The faces of the book (spec 26, section 6). A style names its faces; a face is the `.ttf` of that
 * name in `fonts/` when it is shipped, and the Noto face of the style's fallback family when it is
 * not (the four Noto faces are in the repository; the designed ones come with their licences).
 *
 * Guest text is drawn in the style's own face **if it has every glyph**, else the whole string in the
 * fallback: a name is never half in one font. The coverage is read once per file with `fontkit`.
 */

const FONT_DIRECTORY = join(__dirname, '..', 'fonts')

export type FaceRole = 'title' | 'body' | 'authors'

/** The file of each face of a style, by role. */
const FILES: Readonly<Record<string, Readonly<Record<FaceRole, string>>>> = {
  classique: {
    title: 'CormorantGaramond-SemiBold.ttf',
    body: 'CormorantGaramond-Italic.ttf',
    authors: 'Inter-SemiBold.ttf',
  },
  magazine: {
    title: 'Fraunces-Black.ttf',
    body: 'Inter-Regular.ttf',
    authors: 'Inter-SemiBold.ttf',
  },
  souvenir: {
    title: 'Caveat-Bold.ttf',
    body: 'Caveat-Medium.ttf',
    authors: 'Caveat-Bold.ttf',
  },
}

export interface Faces {
  /** Path of each role's face: the style's own, or its Noto stand-in. */
  readonly paths: Readonly<Record<FaceRole, string>>
  /** Whether each role is a designed face (`false`: the stand-in is the fallback already). */
  readonly designed: Readonly<Record<FaceRole, boolean>>
  /** The fallback faces of the style's family. */
  readonly fallback: { readonly regular: string; readonly bold: string }
}

const NOTO = {
  'Noto Serif': { regular: 'NotoSerif-Regular.ttf', bold: 'NotoSerif-Bold.ttf' },
  'Noto Sans': { regular: 'NotoSans-Regular.ttf', bold: 'NotoSans-Bold.ttf' },
} as const

export const facesOf = (style: BookStyleDef): Faces => {
  const noto = NOTO[style.fallbackFont]
  const regular = join(FONT_DIRECTORY, noto.regular)
  const bold = join(FONT_DIRECTORY, noto.bold)
  const files = FILES[style.id] as Readonly<Record<FaceRole, string>>
  const pick = (role: FaceRole): { path: string; designed: boolean } => {
    const own = join(FONT_DIRECTORY, files[role])
    if (existsSync(own)) return { path: own, designed: true }
    return { path: role === 'title' ? bold : regular, designed: false }
  }
  const title = pick('title')
  const body = pick('body')
  const authors = pick('authors')
  return {
    paths: { title: title.path, body: body.path, authors: authors.path },
    designed: { title: title.designed, body: body.designed, authors: authors.designed },
    fallback: { regular, bold },
  }
}

const opened = new Map<string, Font>()

/** Can this face draw every visible character of `text`? Read from the file once. */
export const covers = (path: string, text: string): boolean => {
  let font = opened.get(path)
  if (font === undefined) {
    font = openSync(path)
    opened.set(path, font)
  }
  for (const char of text) {
    const code = char.codePointAt(0) as number
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) continue
    if (!font.hasGlyphForCodePoint(code)) return false
  }
  return true
}
