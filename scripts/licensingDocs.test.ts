import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The words that announce the AGPL relicence to the people who run EventSlide (roadmap
 * G1-08 / P1-10), held to what the repository can check about them.
 *
 * `v3.0.0` announces the licence (and, being a major, points at what it breaks) and nothing
 * else; `v2.1.0`, the release before it, is the last one under the GPL-3.0. Anything about
 * the maintainer's own way of running it for other people is announced separately and later,
 * and until then a sentence about it in a public, indexed repository is a promise nobody has
 * decided to make. That is a boundary rather than a format, so it is a test: a document
 * written for a self-hoster gets longer one well-meant sentence at a time. The announcement
 * that lifts the boundary edits this file in the same change.
 *
 * The other half is that the FAQ must stay true. The commit where the GPL gives way to the
 * AGPL is a fact `.github/gpl-boundary` already commits to and `scripts/licenseMetadata.test.ts`
 * already holds the CI job to; a FAQ that quotes it from memory drifts the day somebody
 * corrects the file.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...segments: string[]): string => readFileSync(join(ROOT, ...segments), 'utf8')

/** A document as running text: Prettier wraps lines, and a phrase can break across one. */
const prose = (...segments: string[]): string => read(...segments).replace(/\s+/g, ' ')

const FAQ = join('docs', 'LICENSING-FAQ.md')
const DRAFTS = join('docs', 'releases', 'v3.0.0.md')

/** The release the AGPL starts with, and the last one under the GPL. */
const FIRST_AGPL_RELEASE = 'v3.0.0'
const LAST_GPL_RELEASE = 'v2.1.0'

/**
 * Words that announce or hint at running the software for other people as an offer.
 * `self-hosted` and `self-hosters` are the opposite and are everywhere, hence the lookbehind.
 */
const HOSTED_SERVICE =
  /(?<!self-)\bhost(?:ed|ing)\b|\bSaaS\b|\bmanaged\b|\binstances?\b|\binvitation\b|\bas a service\b|\bcloud\b/i

/** The GPL, and not the AGPL: `AGPL-3.0` contains the characters `GPL-3.0`. */
const GPL = /(?<!A)GPL-3\.0/

/** The commit `.github/gpl-boundary` commits to, which the tag `gpl-final` is cut on. */
const boundary = (): string => read('.github', 'gpl-boundary').trim()

/** The CHANGELOG entry of this release, heading included, as running text. */
const changelogEntry = (version: string): string => {
  const entry = read('CHANGELOG.md')
    .split(/^## /m)
    .find((section) => section.startsWith(`[${version}]`))
  if (entry === undefined) throw new Error(`CHANGELOG.md has no entry for ${version}`)
  return entry.replace(/\s+/g, ' ')
}

/** Every commit hash a text spells out. They must all be the boundary: there is only one. */
const hashesIn = (text: string): readonly string[] => text.match(/\b[0-9a-f]{40}\b/g) ?? []

/** The relative file links of a Markdown file, resolved against the file's own directory. */
const relativeLinks = (file: string): readonly string[] =>
  [...read(file).matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g)].map((match) =>
    join(dirname(join(ROOT, file)), match[1] ?? ''),
  )

describe('the licence FAQ for people who run the image', () => {
  it('has a section for each of the three people the plan names: unmodified, modified, forked', () => {
    const headings = read(FAQ)
      .split('\n')
      .filter((line) => /^#{2,3} /.test(line))
      .join('\n')

    expect(headings).toMatch(/unmodified/i)
    expect(headings).toMatch(/\bmodif(y|ie[sd])\b/i)
    expect(headings).toMatch(/\bfork/i)
  })

  it('names the licence, the network clause and the setting that carries the source offer', () => {
    const text = prose(FAQ)

    expect(text).toContain('AGPL-3.0-only')
    expect(text).toMatch(/section 13/i)
    expect(text).toContain('SOURCE_CODE_URL')
  })

  it('says the grant is "only", with no "or any later version"', () => {
    expect(prose(FAQ)).toContain('no "or any later version"')
  })

  it('says that everything up to the boundary stays GPL-3.0, with the commit that bounds it', () => {
    const text = prose(FAQ)

    expect(text).toMatch(GPL)
    expect(text).toContain('gpl-final')
    expect(text).toContain(boundary())
    expect(text).toContain('.github/gpl-boundary')
    expect(text).toMatch(/irrevocable/i)
  })

  it('names no commit but the boundary', () => {
    expect(new Set(hashesIn(read(FAQ)))).toEqual(new Set([boundary()]))
  })

  it('announces no service', () => {
    expect(prose(FAQ)).not.toMatch(HOSTED_SERVICE)
  })

  it('links only to files that exist', () => {
    const links = relativeLinks(FAQ)

    expect(links.length, 'relative links in the FAQ').toBeGreaterThan(0)
    for (const link of links) expect(existsSync(link), link).toBe(true)
  })

  it('is reachable from the README, where a self-hoster looks', () => {
    expect(read('README.md')).toContain('(docs/LICENSING-FAQ.md)')
  })
})

describe('where the AGPL starts, said in the places a self-hoster reads', () => {
  it.each([
    ['the FAQ', FAQ],
    ['the README', 'README.md'],
  ])(
    'says in %s that v3.0.0 is the first release under the AGPL and v2.1.0 the last under the GPL',
    (_name, file) => {
      const text = prose(file)

      expect(text).toContain(`\`${FIRST_AGPL_RELEASE}\` is the first release under the AGPL`)
      expect(text).toContain(`\`${LAST_GPL_RELEASE}\` is the last release under the GPL-3.0`)
      expect(text).toContain('`gpl-final`')
    },
  )

  it.each([
    ['the FAQ', FAQ],
    ['the README', 'README.md'],
  ])(
    'never ties v2.1.0 to the AGPL in %s: each sentence or table row that names it says GPL-3.0',
    (_name, file) => {
      // 2.1.0 was prepared as the first AGPL release and published as the last GPL one, so the
      // mistake to catch is a sentence from the first plan that survived the second.
      const units = read(file)
        .split(/\n\s*\n/)
        .flatMap((block) =>
          block.startsWith('|')
            ? block.split('\n')
            : block.replace(/\s+/g, ' ').split(/(?<=[.;]) /),
        )
      const naming = units.filter((unit) => unit.includes('2.1.0'))

      expect(naming.length, `sentences naming 2.1.0 in ${file}`).toBeGreaterThan(0)
      for (const unit of naming) expect(unit).toMatch(GPL)
    },
  )
})

describe('the CHANGELOG entry of 3.0.0', () => {
  it('announces no service', () => {
    expect(changelogEntry('3.0.0')).not.toMatch(HOSTED_SERVICE)
  })

  it('names no commit but the boundary', () => {
    expect(new Set(hashesIn(changelogEntry('3.0.0')))).toEqual(new Set([boundary()]))
  })
})

// The drafts are deleted once they are posted, and that must not turn the build red.
describe.skipIf(!existsSync(join(ROOT, DRAFTS)))(
  'the drafts of what the maintainer posts with the release',
  () => {
    it('announce the licence, with the boundary, and no service', () => {
      const text = prose(DRAFTS)

      expect(text).toContain('AGPL-3.0-only')
      expect(text).toContain('gpl-final')
      expect(text).toContain(boundary())
      expect(text).not.toMatch(HOSTED_SERVICE)
    })

    it('say that v3.0.0 starts the AGPL, that v2.1.0 is the last GPL release, and what breaks', () => {
      const text = prose(DRAFTS)

      expect(text).toContain(`\`${FIRST_AGPL_RELEASE}\` is the first release under it`)
      expect(text).toContain(`\`${LAST_GPL_RELEASE}\``)
      // A major: the release notes send the reader to the BREAKING section and the upgrade page.
      expect(text).toContain('BREAKING')
      expect(text).toContain('docs/UPGRADING.md#upgrading-to-30')
    })

    it('name no commit but the boundary', () => {
      expect(new Set(hashesIn(read(DRAFTS)))).toEqual(new Set([boundary()]))
    })

    it('say that they have not been posted', () => {
      expect(prose(DRAFTS)).toMatch(/(?:has|have) not been posted/i)
    })

    it('link to local files that exist', () => {
      const links = relativeLinks(DRAFTS)

      expect(links.length, 'relative links in the drafts').toBeGreaterThan(0)
      for (const link of links) expect(existsSync(link), link).toBe(true)
    })
  },
)
