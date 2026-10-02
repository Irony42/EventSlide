import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseEntries, policyProblems } from './changelogPolicy'

/**
 * The upgrade policy (`docs/UPGRADING.md`, roadmap G3-09 / P4-11) as far as a CHANGELOG can
 * be held to it: a major has a `BREAKING` section and a page here that says what to change,
 * and nothing else has a `BREAKING` section.
 *
 * Most of this file feeds `policyProblems` a CHANGELOG written to break the rule, because the
 * real one has a single entry today and a check that only ever sees the one valid input
 * proves nothing. The last block runs it on the real files, which is what will fail the day
 * `3.0.0` is cut without them.
 */

const entry = (version: string, sections: readonly string[] = []): string =>
  [`## [${version}] - 2026-01-01`, '', ...sections.map((s) => `### ${s}\n\n- something\n`)].join(
    '\n',
  )

const changelog = (...entries: readonly string[]): string =>
  ['# Changelog', '', 'A preamble.', '', ...entries].join('\n')

const UPGRADING_TO_3 = '# Upgrading\n\n## Upgrading to 3.0\n\nWhat to change.\n'
const NOTHING_TO_UPGRADE = '# Upgrading\n\n## Upgrading to a major\n\nNone yet.\n'

describe('reading a CHANGELOG', () => {
  it('takes one entry per `## [X.Y.Z] - date` heading, newest first, with its sections', () => {
    const entries = parseEntries(
      changelog(entry('3.0.0', ['BREAKING', 'Added']), entry('2.1.0', ['Licence'])),
    )

    expect(entries.map((e) => e.version)).toEqual(['3.0.0', '2.1.0'])
    expect(entries.map((e) => e.major)).toEqual([3, 2])
    expect(entries[0]?.sections).toEqual(['BREAKING', 'Added'])
  })

  it('does not count a heading that is not an entry, or a heading inside a code block', () => {
    const text = [
      '# Changelog',
      '### BREAKING',
      '## 2.0.0 (never tagged)',
      '### BREAKING',
      entry('2.1.0', ['Added']),
      '```md',
      '### BREAKING',
      '```',
    ].join('\n')

    expect(parseEntries(text)).toEqual([{ version: '2.1.0', major: 2, sections: ['Added'] }])
  })

  it('does not credit an entry with the sections under the heading that follows it', () => {
    // A hand-written heading that is not an entry, such as `## 2.0.0 (never tagged)`, below 2.1.0.
    const text = [
      changelog(entry('2.1.0', ['Added'])),
      '## 2.0.0 (never tagged)',
      '### BREAKING',
    ].join('\n')

    expect(parseEntries(text)).toEqual([{ version: '2.1.0', major: 2, sections: ['Added'] }])
  })

  it('reads the heading release-please writes, a compare link and a date in parentheses', () => {
    const text = changelog(
      '## [3.0.0](https://github.com/Irony42/EventSlide/compare/v2.1.0...v3.0.0) (2026-11-01)',
      '',
      '### BREAKING CHANGES',
      '',
      entry('2.1.0'),
    )

    expect(parseEntries(text).map((e) => e.version)).toEqual(['3.0.0', '2.1.0'])
  })
})

describe('a heading that opens like an entry and is not one', () => {
  it.each(['## [Unreleased]', '## [3.0.0-rc.1] - 2026-10-30', '## [3.0] - 2026-11-01'])(
    'is named, because an entry nobody can read is an entry nobody judges: %s',
    (heading) => {
      const text = changelog(heading, '', '### BREAKING', '', entry('2.1.0'))

      expect(policyProblems(text, NOTHING_TO_UPGRADE)).toEqual([
        `the heading "${heading}" is not an entry ("## [X.Y.Z]"), so it is not judged`,
      ])
    },
  )

  it('is not named inside a code block, nor when it is not a bracketed heading at all', () => {
    const text = changelog(
      entry('2.1.0'),
      '## 2.0.0 (never tagged)',
      '```md',
      '## [Unreleased]',
      '```',
    )

    expect(policyProblems(text, NOTHING_TO_UPGRADE)).toEqual([])
  })
})

describe('a major', () => {
  it('passes with a BREAKING section here and an `Upgrading to N.0` section there', () => {
    const text = changelog(entry('3.0.0', ['BREAKING']), entry('2.1.0'))

    expect(policyProblems(text, UPGRADING_TO_3)).toEqual([])
  })

  it('is named when its entry has no BREAKING section', () => {
    const text = changelog(entry('3.0.0', ['Added']), entry('2.1.0'))

    expect(policyProblems(text, UPGRADING_TO_3)).toEqual([
      '3.0.0 is a major (it follows 2.1.0) and has no BREAKING section',
    ])
  })

  it('is named when docs/UPGRADING.md has no section for it', () => {
    const text = changelog(entry('3.0.0', ['BREAKING']), entry('2.1.0'))

    expect(policyProblems(text, NOTHING_TO_UPGRADE)).toEqual([
      '3.0.0 is a major and docs/UPGRADING.md has no "## Upgrading to 3.0" section',
    ])
  })

  it('needs the section of its own number, not of an earlier major', () => {
    const text = changelog(entry('4.0.0', ['BREAKING']), entry('3.2.0'))

    expect(policyProblems(text, UPGRADING_TO_3)).toEqual([
      '4.0.0 is a major and docs/UPGRADING.md has no "## Upgrading to 4.0" section',
    ])
  })

  it('is still a major when it skips a number', () => {
    const text = changelog(entry('4.0.0', ['Added']), entry('2.1.0'))

    expect(policyProblems(text, UPGRADING_TO_3)).toHaveLength(2)
  })

  it('accepts the heading release-please writes, a warning sign before the word', () => {
    const generated = `${String.fromCharCode(0x26a0)} BREAKING CHANGES`
    const text = changelog(entry('3.0.0', [generated]), entry('2.1.0'))

    expect(policyProblems(text, UPGRADING_TO_3)).toEqual([])
  })
})

describe('a minor or a patch', () => {
  it.each([
    ['a minor', '2.2.0'],
    ['a patch', '2.1.1'],
  ])('is named when %s has a BREAKING section', (_kind, version) => {
    const text = changelog(entry(version, ['BREAKING']), entry('2.1.0'))

    expect(policyProblems(text, NOTHING_TO_UPGRADE)).toEqual([
      `${version} has a BREAKING section but follows 2.1.0 in the same major: only a major may break something`,
    ])
  })

  it('may say what to check before upgrading without calling it BREAKING', () => {
    const text = [
      changelog(entry('2.2.0', ['Behaviour changes to check before upgrading'])),
      '- This is not a BREAKING change, only a thing to check.',
      entry('2.1.0'),
    ].join('\n')

    expect(policyProblems(text, NOTHING_TO_UPGRADE)).toEqual([])
  })

  it.each(['Not breaking anything', 'Not BREAKING anything', 'Fixed a BREAKING-looking bug'])(
    'does not take a heading that merely mentions breaking for the BREAKING section: %s',
    (heading) => {
      const text = changelog(entry('2.2.0', [heading]), entry('2.1.0'))

      expect(policyProblems(text, NOTHING_TO_UPGRADE)).toEqual([])
    },
  )
})

describe('the oldest entry', () => {
  it('follows nothing the file shows, so it is not judged', () => {
    expect(policyProblems(changelog(entry('2.1.0', ['BREAKING'])), NOTHING_TO_UPGRADE)).toEqual([])
    expect(policyProblems(changelog(entry('3.0.0')), NOTHING_TO_UPGRADE)).toEqual([])
  })
})

describe('the CHANGELOG and docs/UPGRADING.md of this tree', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
  const read = (...segments: string[]): string => readFileSync(join(ROOT, ...segments), 'utf8')

  it('follow the policy', () => {
    const real = read('CHANGELOG.md')

    expect(parseEntries(real).length, 'entries in CHANGELOG.md').toBeGreaterThan(0)
    expect(policyProblems(real, read('docs', 'UPGRADING.md'))).toEqual([])
  })

  it('are read by a check whose two headings the page names', () => {
    // The page names the sections the check looks for; if it stopped doing so the check
    // would pass for the wrong reason.
    expect(read('docs', 'UPGRADING.md')).toContain('`Upgrading to N.0`')
    expect(read('docs', 'UPGRADING.md')).toContain('`### BREAKING`')
  })
})
