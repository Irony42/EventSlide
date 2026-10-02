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

/** The newest entry of the CHANGELOG: its heading line and everything up to the next `## `. */
const newestEntry = (): { heading: string; body: string } => {
  const lines = read('CHANGELOG.md').split('\n')
  const start = lines.findIndex((line) => line.startsWith('## '))
  if (start === -1) throw new Error('CHANGELOG.md has no `## ` entry')
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  const entry = lines.slice(start, next === -1 ? undefined : next)
  return { heading: entry[0] ?? '', body: entry.slice(1).join('\n') }
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

describe('the CHANGELOG entry of this release', () => {
  it('says the licence change first, before any feature', () => {
    const sections = newestEntry()
      .body.split('\n')
      .filter((line) => line.startsWith('### '))

    expect(sections[0]).toBe('### Licence')
  })

  it('names the new licence, the old one and the commit where one gives way to the other', () => {
    const licence = newestEntry().body.split('\n### ')[1] ?? ''
    const boundary = read('.github', 'gpl-boundary').trim()

    expect(licence).toContain('AGPL-3.0-only')
    // `AGPL-3.0-only` contains the characters `GPL-3.0`, so a bare substring would pass
    // with no mention of the old licence at all.
    expect(licence).toMatch(/(?<!A)GPL-3\.0/)
    expect(licence).toContain('gpl-final')
    expect(licence).toContain(boundary)
  })
})
