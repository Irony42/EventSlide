import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * ADR format contract.
 *
 * Every ADR is one decision record under `docs/adr/NNNN-name.md`. Its first line is
 * `# ADR NNNN — Title`, with NNNN the number in its file name, and it then carries, in
 * this order, the sections Status, Date, Context, Decision, Consequences — which itself
 * holds `### Positive`, `### Negative` and `### Neutral`, in that order — then
 * Alternatives considered and Related. No required section may be empty. Checking this
 * mechanically rather than at review time is the same bet `migrationIds.test.ts` and
 * `docDrift.test.ts` make in this directory: a convention nobody runs stops being one
 * the moment review is rushed.
 *
 * Three ADRs predate the convention and are **named exceptions, not a silent skip**.
 * Grandfathering is a decision about old content, never a weaker rule for new content:
 * a new ADR that omits `Related`, or whose title does not match, still fails by name
 * unless someone adds it to one of the lists below, in a diff a reviewer can see.
 *
 * - `0001`, `0002` and `0004` have every section except `Related`.
 * - `0002` also predates the `ADR NNNN` title: its heading is `# 2. Vitest over Jest`.
 *
 * Each exception cleans itself up: once the ADR is fixed, the test says to drop it from
 * the list, so the lists can only shrink.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ADR_DIR = join(ROOT, 'docs', 'adr')

/** ADRs allowed to omit `## Related`. Nothing else may. */
const NO_RELATED_REQUIRED: ReadonlySet<string> = new Set([
  '0001-hexagonal-architecture.md',
  '0002-vitest-over-jest.md',
  '0004-remove-passport.md',
])

/** ADRs allowed to keep a pre-`ADR NNNN` title. Nothing else may. */
const LEGACY_TITLE_ALLOWED: ReadonlySet<string> = new Set(['0002-vitest-over-jest.md'])

const ADR_FILE = /^(\d{4})-.+\.md$/
const TITLE = /^# ADR (\d{4}) — \S.*$/

const REQUIRED_SECTIONS = [
  'Status',
  'Date',
  'Context',
  'Decision',
  'Consequences',
  'Alternatives considered',
] as const

const CONSEQUENCES_SUBSECTIONS = ['Positive', 'Negative', 'Neutral'] as const

const adrFiles = (): string[] =>
  readdirSync(ADR_DIR)
    .filter((name) => ADR_FILE.test(name))
    .sort()

const read = (name: string): string => readFileSync(join(ADR_DIR, name), 'utf8')

interface Section {
  readonly title: string
  readonly lines: readonly string[]
}

/**
 * The `## ` sections of a document, in order, ignoring anything inside a code fence (an
 * ADR quotes SQL, shell and config, and a `## ` line there is not a heading).
 */
const sectionsOf = (body: string): Section[] => {
  const sections: { title: string; lines: string[] }[] = []
  let fenced = false
  for (const line of body.split('\n')) {
    if (line.trimStart().startsWith('```')) fenced = !fenced
    const heading = fenced ? null : /^## (.+?)\s*$/.exec(line)
    if (heading?.[1] !== undefined) {
      sections.push({ title: heading[1], lines: [] })
    } else {
      sections.at(-1)?.lines.push(line)
    }
  }
  return sections
}

const subheadingsOf = (section: Section): string[] => {
  const found: string[] = []
  let fenced = false
  for (const line of section.lines) {
    if (line.trimStart().startsWith('```')) fenced = !fenced
    const heading = fenced ? null : /^### (.+?)\s*$/.exec(line)
    if (heading?.[1] !== undefined) found.push(heading[1])
  }
  return found
}

const hasContent = (section: Section): boolean => section.lines.some((line) => line.trim() !== '')

describe('ADR format (scripts/adrFormat.test.ts)', () => {
  it('finds the ADRs this repository already has', () => {
    // A regression here means the directory moved or emptied, not that the format is
    // wrong: every it.each below is vacuous against zero files.
    expect(adrFiles().length).toBeGreaterThanOrEqual(7)
  })

  it.each(adrFiles())('%s opens with "# ADR NNNN — Title", NNNN being its file number', (name) => {
    const firstLine = read(name).split('\n')[0] ?? ''
    if (LEGACY_TITLE_ALLOWED.has(name)) {
      expect(
        firstLine,
        `${name} now has the ADR NNNN title — drop it from LEGACY_TITLE_ALLOWED`,
      ).not.toMatch(TITLE)
      expect(firstLine).toMatch(/^# \S/)
      return
    }
    const match = TITLE.exec(firstLine)
    expect(match, `${name}'s first line is "${firstLine}"`).not.toBeNull()
    expect(match?.[1], `${name}'s heading number`).toBe(name.slice(0, 4))
  })

  it.each(adrFiles())('%s carries the required sections, in order', (name) => {
    const titles = sectionsOf(read(name)).map((section) => section.title)
    const expected: string[] = NO_RELATED_REQUIRED.has(name)
      ? [...REQUIRED_SECTIONS]
      : [...REQUIRED_SECTIONS, 'Related']
    // Status, Date, Context, Decision, Consequences, Alternatives considered, and Related
    // last where it is required. A section of another name between them (an Appendix,
    // say) is not this file's business.
    const present = titles.filter((title) => expected.includes(title))
    expect(present, `${name}'s required sections, in order`).toEqual(expected)
  })

  it.each(adrFiles())('%s has no empty required section', (name) => {
    const required: string[] = [...REQUIRED_SECTIONS, 'Related']
    for (const section of sectionsOf(read(name))) {
      if (required.includes(section.title)) {
        expect(hasContent(section), `${name}'s "## ${section.title}" is empty`).toBe(true)
      }
    }
  })

  it.each(adrFiles())(
    '%s splits Consequences into Positive, Negative and Neutral, in that order',
    (name) => {
      const consequences = sectionsOf(read(name)).find(
        (section) => section.title === 'Consequences',
      )
      expect(consequences, `${name} has no "## Consequences"`).toBeDefined()
      if (consequences === undefined) return
      expect(subheadingsOf(consequences), `${name}'s Consequences subsections`).toEqual([
        ...CONSEQUENCES_SUBSECTIONS,
      ])
    },
  )

  it.each(adrFiles().filter((name) => NO_RELATED_REQUIRED.has(name)))(
    '%s is a named exception and still has no Related section',
    (name) => {
      const titles = sectionsOf(read(name)).map((section) => section.title)
      expect(titles, `${name} has Related now — drop it from NO_RELATED_REQUIRED`).not.toContain(
        'Related',
      )
    },
  )
})
