import { describe, expect, it } from 'vitest'

/**
 * No raw colour, duration or touch size outside `tokens.css` — the source, read.
 *
 * Rule 2 of CLAUDE.md says the design system is the only place a raw value exists, and
 * `tokensUsed.guard.test.ts` checks the other direction (a declared token is used). Nothing
 * checked that a stylesheet reaches for a token rather than typing the value: one `#000` and a
 * handful of `700ms` had slipped in. This reads every stylesheet under `web/src` except
 * `tokens.css` and fails on:
 *
 * - a colour written as a hex literal, a colour function (`rgb(`, `hsl(`, `oklch(`, `color(`...)
 *   or the keywords `white` / `black`;
 * - a time written as a literal (`700ms`, `1.2s`), other than the zero that switches a motion
 *   off (`0s`, `0ms`);
 * - a literal `44px` as a minimum size: the touch target is `var(--touch-min)`.
 *
 * What stays is named in {@link ALLOWED}, each with its reason, and the list is exact in both
 * directions: an entry that no longer matches anything fails too, so it cannot outlive the line
 * it excused.
 *
 * Read as text rather than imported, for the reason `classNames.guard.test.ts` is: no
 * behaviour tells a token from the value it stands for.
 */

const SOURCES = import.meta.glob<string>('../**/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Glob keys arrive relative to this file: a sibling as `./x`, a cousin as `../app/x`. */
const named = (path: string): string =>
  path.replace(/^\.\//, 'design-system/').replace(/^\.\.\//, '')

/** Comments blanked rather than removed, so the line numbers stay the file's own. */
const withoutCssComments = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))

const TOKENS_FILE = 'design-system/tokens.css'

const stylesheets = Object.entries(SOURCES)
  .map(([path, source]) => [named(path), withoutCssComments(source)] as const)
  .filter(([path]) => path !== TOKENS_FILE)

type Kind = 'colour' | 'duration' | 'touch'

/** The pattern each kind of raw value is found by. */
const PATTERNS: Readonly<Record<Kind, RegExp>> = {
  colour:
    /#[0-9a-fA-F]{3,8}(?![\w-])|\b(?:rgba?|hsla?|hwb|oklch|oklab|lch|lab|color)\(|(?<![\w-])(?:white|black)(?![\w-])/g,
  // Zero is no duration: `animation-duration: 0s` is how a motion is switched off.
  duration: /(?<![\w.#-])(?!0+(?:\.0+)?m?s)\d*\.?\d+m?s(?![\w%-])/g,
  touch: /\bmin-(?:height|width|block-size|inline-size)\s*:\s*44px/g,
}

interface Hit {
  readonly file: string
  readonly line: number
  readonly kind: Kind
  readonly text: string
}

/** Every raw value `css` carries, with its line. */
const hitsIn = (file: string, css: string): readonly Hit[] =>
  css
    .split('\n')
    .flatMap((text, index) =>
      (Object.keys(PATTERNS) as Kind[])
        .filter((kind) => text.match(PATTERNS[kind]) !== null)
        .map((kind) => ({ file, line: index + 1, kind, text: text.trim() })),
    )

/**
 * The raw values kept on purpose, by file, each with the reason. `lines` is how many lines of
 * that file carry one.
 */
const ALLOWED: Readonly<
  Record<string, { readonly kind: Kind; readonly lines: number; readonly reason: string }>
> = {
  'design-system/base.css': {
    kind: 'duration',
    lines: 2,
    reason:
      'the reduced-motion rule collapses every animation and transition to 0.01ms on purpose: ' +
      'a hair above zero, so `animationend` still fires and nothing waits for a motion that is off',
  },
  'design-system/components/Garland.module.css': {
    kind: 'duration',
    lines: 14,
    reason:
      'the garland is an illustration with its own timeline (the strand draws, each bulb falls ' +
      'in turn, then it sways): the stagger is part of the drawing, not an interface duration, ' +
      'and no other surface shares it',
  },
}

const allHits = stylesheets.flatMap(([file, css]) => hitsIn(file, css))

const isAllowed = (hit: Hit): boolean => ALLOWED[hit.file]?.kind === hit.kind

describe('no raw colour, duration or touch size outside tokens.css', () => {
  it('has something to read, rather than an empty glob', () => {
    const files = stylesheets.map(([path]) => path)
    expect(files.length).toBeGreaterThan(100)
    expect(files).toContain('design-system/components/Spinner.module.css')
    expect(files).not.toContain(TOKENS_FILE)
  })

  it('finds each kind of raw value, and nothing a token reference spells', () => {
    // The detector pointed at known positives and known negatives: without this, "no hit"
    // below is as green for a broken pattern as for a clean tree.
    const kinds = (css: string): readonly Kind[] => hitsIn('x.css', css).map((hit) => hit.kind)

    expect(kinds('a { background: #000; }')).toEqual(['colour'])
    expect(kinds('a { color: #ffffff80; }')).toEqual(['colour'])
    expect(kinds('a { color: rgb(0 0 0); }')).toEqual(['colour'])
    expect(kinds('a { color: oklch(50% 0 0); }')).toEqual(['colour'])
    expect(kinds('a { color: white; }')).toEqual(['colour'])
    expect(kinds('a { animation: spin 700ms linear; }')).toEqual(['duration'])
    expect(kinds('a { transition: opacity 0.2s; }')).toEqual(['duration'])
    expect(kinds('a { min-height: 44px; }')).toEqual(['touch'])

    expect(kinds('a { background: var(--player-ground); }')).toEqual([])
    expect(kinds('a { color: var(--text-white-ish); }')).toEqual([])
    expect(kinds('a { animation: spin var(--duration-spin) linear; }')).toEqual([])
    expect(kinds('a { animation-duration: 0s; }')).toEqual([])
    expect(kinds('a { transition-duration: 0ms; }')).toEqual([])
    expect(kinds('a { min-height: var(--touch-min); }')).toEqual([])
    expect(kinds('a { block-size: 44px; }')).toEqual([])
    expect(kinds('a { width: 700%; }')).toEqual([])
  })

  it('has none, apart from the ones ALLOWED names', () => {
    const offenders = allHits.filter((hit) => !isAllowed(hit))

    expect(
      offenders.map((hit) => `${hit.file}:${hit.line} (${hit.kind}) ${hit.text}`),
      'raw values in a stylesheet: use a token from tokens.css, add one there, or name the file in ALLOWED with the reason',
    ).toEqual([])
  })

  it('keeps ALLOWED exact: every entry still matches, on as many lines as it says', () => {
    const stale = Object.entries(ALLOWED)
      .filter(
        ([file, entry]) =>
          allHits.filter((hit) => hit.file === file && hit.kind === entry.kind).length !==
          entry.lines,
      )
      .map(([file]) => file)

    expect(stale, 'ALLOWED entries whose line count no longer matches the file').toEqual([])
  })

  it('gives every excuse a reason', () => {
    const blank = Object.entries(ALLOWED)
      .filter(([, entry]) => entry.reason.trim().length < 40)
      .map(([file]) => file)

    expect(blank, 'ALLOWED entries with no reason').toEqual([])
  })
})
