import { describe, expect, it } from 'vitest'
import { withoutComments } from '../testing/withoutComments'

/**
 * A status glyph beside a sentence is a `Notice`, and a feature does not draw one itself
 * — the source, read.
 *
 * The line was written by hand sixteen times, each with a stylesheet of its own: a span
 * around the glyph, a flex row, a frame, a colour. The copies drifted (`align-items`,
 * `font-size`, which surface), and every new screen with something to say copied the
 * nearest one. `Notice` is the one place that spells it now, and this keeps it that way:
 * a production component renders `StatusIcon` only if it is on the list below, with the
 * reason it is not a `Notice`.
 *
 * An allowlist rather than a shape to match, so it has no false positives and a new
 * wrapper around the glyph cannot dodge it: whatever a component wraps it in, it has to
 * name itself here to draw one. The module's path is what is read for an import, so a
 * namespace, a re-export or a dynamic `import()` does not dodge it either. The count is
 * exact, so a second glyph in a file that is allowed one is not covered by it.
 *
 * Read as text rather than imported, for the reason `classNames.guard.test.ts` is.
 */

const COMPONENTS = import.meta.glob<string>('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Glob keys arrive relative to this file: a sibling as `./x`, a cousin as `../app/x`. */
const named = (path: string): string =>
  path.replace(/^\.\//, 'design-system/').replace(/^\.\.\//, '')

/** Production components only: a test may draw a glyph however it likes. */
const production = Object.entries(COMPONENTS)
  .map(([path, source]) => [named(path), source] as const)
  .filter(([path]) => !path.endsWith('.test.tsx'))

interface Allowance {
  /** How many glyphs the file draws. */
  readonly glyphs: number
  /** Why it is not a `Notice`. */
  readonly reason: string
}

/**
 * Where a glyph is drawn without a `Notice`, and why.
 *
 * Adding a line here is the decision this guard exists to make visible: if the new line
 * is a status and a sentence, use `Notice` instead.
 */
const ALLOWED: ReadonlyMap<string, Allowance> = new Map([
  [
    'design-system/components/Notice.tsx',
    { glyphs: 1, reason: 'The primitive: the one place that pairs the glyph with a sentence.' },
  ],
  [
    'design-system/components/Badge.tsx',
    {
      glyphs: 1,
      reason: 'A word-sized pill: the glyph sits inside a chip, not beside a sentence.',
    },
  ],
  [
    'design-system/components/Toast.tsx',
    {
      glyphs: 1,
      reason: 'A transient message that also carries an action and a dismiss button.',
    },
  ],
  [
    'features/admin/components/CeilingBanner.tsx',
    {
      glyphs: 1,
      reason: 'The glyph marks the title of a banner that goes on to a list and an action.',
    },
  ],
  [
    'features/guest-upload/components/MissionChecklist.tsx',
    { glyphs: 1, reason: 'A list marker (done or not yet), not the status of a message.' },
  ],
  [
    'features/guest-upload/components/OfflineNotice.tsx',
    {
      glyphs: 1,
      reason:
        'A card with a title, a hint and a "send now" button, whose frame stays calm on purpose: nothing has gone wrong.',
    },
  ],
  [
    'features/wall/components/WallMissions.tsx',
    { glyphs: 1, reason: 'A list marker on the projected wall, at the projector’s type scale.' },
  ],
  [
    'features/wall/WallPage.tsx',
    {
      glyphs: 2,
      reason:
        'The projected surface: a status pill at --text-xl on the scrim, and the full-screen failure state, neither of which is a line of the host’s or the guest’s UI.',
    },
  ],
])

/** A glyph drawn in JSX: `<StatusIcon tone="…" />`, however it is wrapped or classed. */
const DRAWN = /<StatusIcon\b/g

/**
 * A statement that reaches the module `StatusIcon` lives in, whatever it brings out of it:
 * `import { StatusIcon }`, `import { StatusIcon as Glyph }`, `import * as Glyphs`,
 * `export { StatusIcon } from`. The module's path is what is read, not the name, so a
 * namespace or a re-export cannot dodge it the way a tag-only match could. The clause is
 * the text between the keyword and `from`, and it may not contain another `import` or
 * `export`, so a statement is never read across the one before it.
 */
const FROM_THE_MODULE =
  /\b(?:import|export)\b((?:(?!\b(?:import|export)\b)[^;'"])*?)\bfrom\s*['"][^'"]*\/StatusIcon['"]/g

/** `import('./StatusIcon')`, which carries no clause at all. */
const DYNAMIC = /\bimport\(\s*['"][^'"]*\/StatusIcon['"]\s*\)/

/**
 * Whether a clause takes only types out of the module: `type { StatusTone }`, or a brace
 * list in which every entry says `type`. Those draw nothing, and `MyPhotos` and
 * `UploadQueue` need `StatusTone` and nothing else.
 */
const takesOnlyTypes = (clause: string): boolean => {
  const trimmed = clause.trim()
  if (/^type\s/.test(trimmed)) return true
  const braces = /^\{([^}]*)\}$/.exec(trimmed)
  if (braces === null) return false
  const entries = (braces[1] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  return entries.length > 0 && entries.every((entry) => /^type\s/.test(entry))
}

interface Use {
  readonly drawn: number
  /** The module is reached for something other than a type. */
  readonly imported: boolean
}

/** What one source does with `StatusIcon`. */
const useOf = (source: string): Use => {
  const body = withoutComments(source)
  const reached = [...body.matchAll(FROM_THE_MODULE)].some(
    (statement) => !takesOnlyTypes(statement[1] ?? ''),
  )
  return {
    drawn: [...body.matchAll(DRAWN)].length,
    imported: reached || DYNAMIC.test(body),
  }
}

const NONE: Use = { drawn: 0, imported: false }

describe('a glyph beside a sentence is drawn by Notice and by nothing else', () => {
  it('has something to read, rather than an empty glob', () => {
    expect(production.length).toBeGreaterThan(50)
    expect(production.map(([path]) => path)).toContain('design-system/components/Notice.tsx')
  })

  it('catches the old shape, however it is wrapped, and the aliases it could gain', () => {
    // The detector pointed at known positives: without this, "no offenders" below is as
    // green for a broken regex as for a clean product.
    const spanned = [
      '<p className={styles.warning}>',
      '  <span className={styles.glyph}>',
      '    <StatusIcon tone="warning" />',
      '  </span>',
      '  {text}',
      '</p>',
    ].join('\n')

    expect(useOf(spanned)).toEqual({ drawn: 1, imported: false })
    expect(useOf('<p><StatusIcon tone="danger" />{error}</p>')).toEqual({
      drawn: 1,
      imported: false,
    })
    expect(useOf('<StatusIcon\n  tone={tone}\n  className={styles.icon}\n/>').drawn).toBe(1)
    expect(useOf('<StatusIcon tone="a" /><StatusIcon tone="b" />').drawn).toBe(2)
    expect(useOf("import { StatusIcon } from '../StatusIcon'").imported).toBe(true)
    expect(useOf("import { StatusIcon, type StatusTone } from './StatusIcon'").imported).toBe(true)
    expect(
      useOf("import {\n  StatusIcon,\n  type StatusTone,\n} from './StatusIcon'").imported,
    ).toBe(true)
    expect(
      useOf("import { type StatusTone, StatusIcon as Glyph } from './StatusIcon'").imported,
    ).toBe(true)
  })

  it('catches the module reached by a namespace, a re-export or a dynamic import', () => {
    // The tag is `<Glyphs.StatusIcon`, `<Glyph` or built at run time: none of them is
    // `<StatusIcon`, so the module's path is what gives them away.
    expect(useOf("import * as Glyphs from '../StatusIcon'\n<Glyphs.StatusIcon />").imported).toBe(
      true,
    )
    expect(useOf("export { StatusIcon as Glyph } from './StatusIcon'").imported).toBe(true)
    expect(useOf("export * from './StatusIcon'").imported).toBe(true)
    expect(useOf("const lazy = import('./StatusIcon')").imported).toBe(true)
    expect(useOf('const lazy = import("../../design-system/components/StatusIcon")').imported).toBe(
      true,
    )
  })

  it('lets a type-only import and a call to Notice through', () => {
    expect(useOf("import type { StatusTone } from './StatusIcon'")).toEqual(NONE)
    expect(useOf("import { type StatusTone } from './StatusIcon'")).toEqual(NONE)
    expect(useOf("import { type StatusTone, type StatusIconProps } from './StatusIcon'")).toEqual(
      NONE,
    )
    expect(useOf("export type { StatusTone } from './StatusIcon'")).toEqual(NONE)
    // A statement is read on its own: the line before it is not part of its clause.
    expect(
      useOf("export const TONES = ['a']\nimport type { StatusTone } from './StatusIcon'"),
    ).toEqual(NONE)
    expect(
      useOf('import { Notice } from \'../Notice\'\n<Notice tone="danger">{error}</Notice>'),
    ).toEqual(NONE)
    expect(useOf('<StatusIconBox tone="danger" />').drawn).toBe(0)
  })

  it('ignores a comment that names the glyph', () => {
    expect(useOf('// <StatusIcon tone="danger" /> was here\nconst a = 1')).toEqual(NONE)
    expect(useOf("/* import { StatusIcon } from './StatusIcon' */ const a = 1")).toEqual(NONE)
  })

  it('draws no glyph outside the allowlist', () => {
    const offenders = production
      .filter(([path]) => !ALLOWED.has(path))
      .filter(([, source]) => {
        const use = useOf(source)
        return use.drawn > 0 || use.imported
      })
      .map(([path]) => path)

    expect(offenders, 'these draw a StatusIcon themselves: use Notice').toEqual([])
  })

  it('draws exactly the glyphs each allowance says, in files that still exist', () => {
    // Exact rather than "at most": an allowance for a glyph that was since deleted would
    // excuse the next line somebody writes in that file.
    const drawn = new Map(production.map(([path, source]) => [path, useOf(source).drawn]))

    for (const [path, allowance] of ALLOWED) {
      expect(drawn.get(path), `${path} is allowed ${allowance.glyphs} glyph(s)`).toBe(
        allowance.glyphs,
      )
    }
  })

  it('gives every allowance a reason', () => {
    for (const [path, allowance] of ALLOWED) {
      expect(allowance.reason.length, `${path} has no reason`).toBeGreaterThan(20)
    }
  })
})
