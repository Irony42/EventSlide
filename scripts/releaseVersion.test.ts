import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The release that `package.json` says this tree is, held to the other places a release
 * bump has to reach (roadmap G1-05 / P1-06).
 *
 * `scripts/versionSource.test.ts` already holds `compose.yaml`'s image tag to
 * `package.json`, and `scripts/sourceOffer.test.ts` holds the Dockerfile's `SOURCE_REF`. What
 * neither can hold is what a human writes down at a release: the lockfile's own copy of the
 * number and the CHANGELOG entry that has to be about *this* version. A bump that forgets one
 * of them fails nothing else in the toolchain: `npm ci` accepts a lockfile whose root version
 * is stale, and a CHANGELOG nobody opens is never wrong in a way a build notices.
 *
 * The CHANGELOG is written by hand until release-please takes it over (paid plan P4-08), so
 * until then this is the only thing that notices it was not touched.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...segments: string[]): string => readFileSync(join(ROOT, ...segments), 'utf8')

/** The `version` of an object read from JSON, or `null` when it is not there. */
const versionIn = (value: unknown): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, 'version') : null

const packageVersion = (): string => {
  const version = versionIn(JSON.parse(read('package.json')))
  if (typeof version !== 'string') throw new Error('package.json has no version')
  return version
}

/** The entry that starts at line `start`: its heading line and everything up to the next `## `. */
const entryFrom = (lines: readonly string[], start: number): { heading: string; body: string } => {
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  const entry = lines.slice(start, next === -1 ? undefined : next)
  return { heading: entry[0] ?? '', body: entry.slice(1).join('\n') }
}

/** The newest entry of the CHANGELOG: its heading line and everything up to the next `## `. */
const newestEntry = (): { heading: string; body: string } => {
  const lines = read('CHANGELOG.md').split('\n')
  const start = lines.findIndex((line) => line.startsWith('## '))
  if (start === -1) throw new Error('CHANGELOG.md has no `## ` entry')
  return entryFrom(lines, start)
}

/** Running text: Prettier wraps lines, and a phrase can break across one. */
const flat = (text: string): string => text.replace(/\s+/g, ' ')

/** The entry of one release, wherever it stands in the file. */
const entryOf = (version: string): { heading: string; body: string } => {
  const lines = read('CHANGELOG.md').split('\n')
  const start = lines.findIndex((line) => line.startsWith(`## [${version}] - `))
  if (start === -1) throw new Error(`CHANGELOG.md has no entry for ${version}`)
  return entryFrom(lines, start)
}

describe('the version is written down alike everywhere a release bump reaches', () => {
  it('is the same in package.json and at the root of package-lock.json', () => {
    const lock: unknown = JSON.parse(read('package-lock.json'))
    const packages: unknown =
      typeof lock === 'object' && lock !== null ? Reflect.get(lock, 'packages') : null
    const lockRoot =
      typeof packages === 'object' && packages !== null ? Reflect.get(packages, '') : null

    expect(versionIn(lock), 'package-lock.json "version"').toBe(packageVersion())
    expect(versionIn(lockRoot), 'package-lock.json packages[""].version').toBe(packageVersion())
  })

  it('heads the CHANGELOG with an entry for exactly that version, dated', () => {
    const { heading } = newestEntry()
    const prefix = `## [${packageVersion()}] - `

    expect(heading.startsWith(prefix), `a heading that starts with "${prefix}"`).toBe(true)
    const date = heading.slice(prefix.length)

    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(new Date(`${date}T00:00:00Z`).toISOString().startsWith(date), 'a real date').toBe(true)
  })

  it('is the version the example responses in docs/API.md show', () => {
    const api = read('docs', 'API.md')
    const shown = [...api.matchAll(/"version": "(\d+\.\d+\.\d+[^"]*)"/g)].map((m) => m[1])
    const refs = [...api.matchAll(/\/tree\/v(\d+\.\d+\.\d+[^"\s]*)/g)].map((m) => m[1])

    expect(shown.length, 'version examples in docs/API.md').toBeGreaterThan(0)
    expect(new Set(shown)).toEqual(new Set([packageVersion()]))
    expect(refs.length, 'source-link examples in docs/API.md').toBeGreaterThan(0)
    expect(new Set(refs)).toEqual(new Set([packageVersion()]))
  })
})

// The entry of 3.0.0 and not the newest one: it is the release that changed the licence, and
// the entry of a release after it has no reason to say so first. Held to the newest entry, these
// would go red the day 3.1.0 is written up, for a reason that had nothing to do with 3.1.0.
describe('the CHANGELOG entry of 3.0.0, the release that changed the licence', () => {
  it('says the licence change first, before any feature', () => {
    const sections = entryOf('3.0.0')
      .body.split('\n')
      .filter((line) => line.startsWith('### '))

    expect(sections[0]).toBe('### Licence')
  })

  it('names the new licence, the old one and the commit where one gives way to the other', () => {
    const licence = entryOf('3.0.0').body.split('\n### ')[1] ?? ''
    const boundary = read('.github', 'gpl-boundary').trim()

    expect(licence).toContain('AGPL-3.0-only')
    // `AGPL-3.0-only` contains the characters `GPL-3.0`, so a bare substring would pass
    // with no mention of the old licence at all.
    expect(licence).toMatch(/(?<!A)GPL-3\.0/)
    expect(licence).toContain('gpl-final')
    expect(licence).toContain(boundary)
  })

  it('names the last GPL release and says that it is this one that starts the AGPL', () => {
    const licence = flat(entryOf('3.0.0').body.split('\n### ')[1] ?? '')

    expect(licence).toContain('2.1.0')
    expect(licence).toMatch(/3\.0\.0 is the first release under it/)
  })
})

// 2.1.0 was prepared as the AGPL release and was published as the last GPL one. Its entry is
// the record of what the published release is, so it is held to saying so.
describe('the CHANGELOG entry of 2.1.0, the last release under the GPL', () => {
  it('says it is GPL-3.0 and that the AGPL is the next release', () => {
    const entry = flat(entryOf('2.1.0').body)

    expect(entry).toMatch(/(?<!A)GPL-3\.0/)
    expect(entry).toMatch(/last release under the GPL-3\.0/)
    expect(entry).toMatch(/next release, 3\.0\.0, is licensed AGPL-3\.0-only/)
  })

  it('names the commit it was cut on, the one the tag gpl-final also names', () => {
    const entry = entryOf('2.1.0').body

    expect(entry).toContain(read('.github', 'gpl-boundary').trim())
    expect(entry).toContain('gpl-final')
  })
})

// The entries of 2.0.0 and 2.1.0 were written after those releases were published, from their
// release notes, so each one points at the release it describes.
describe('the CHANGELOG entries of the releases already published', () => {
  it.each(['2.0.0', '2.1.0'])('%s links its GitHub release', (version) => {
    expect(entryOf(version).body).toContain(
      `https://github.com/Irony42/EventSlide/releases/tag/v${version}`,
    )
  })
})

// What separates the two entries is a pull request number. #103 is the last pull request the
// GPL-3.0 release carries (the merge that `gpl-final` and `v2.1.0` name), and #104 the first
// one after it. A pull request cited on the wrong side of that is a change attributed to the
// wrong licence and the wrong version, and nothing else in the toolchain reads those numbers.
describe('the pull requests each CHANGELOG entry cites', () => {
  const LAST_PULL_REQUEST_OF_2_1_0 = 103
  const pullRequests = (version: string): readonly number[] =>
    [...entryOf(version).body.matchAll(/(?<![\w&])#(\d+)\b/g)].map((match) => Number(match[1]))

  it('stop at #103 in the entry of 2.1.0, which is the release cut on that merge', () => {
    const cited = pullRequests('2.1.0')

    expect(cited.length, 'pull requests cited by 2.1.0').toBeGreaterThan(0)
    expect(Math.max(...cited)).toBe(LAST_PULL_REQUEST_OF_2_1_0)
  })

  it('start after #103 in the entry of 3.0.0', () => {
    const cited = pullRequests('3.0.0')

    expect(cited.length, 'pull requests cited by 3.0.0').toBeGreaterThan(0)
    expect(Math.min(...cited)).toBeGreaterThan(LAST_PULL_REQUEST_OF_2_1_0)
  })
})
