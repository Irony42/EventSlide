import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `docs/IMAGE-SOURCES.md` (roadmap G3-08 / P4-08), held to what it points at.
 *
 * The page is the written offer for the GPL and LGPL parts of a published image, and the
 * instructions for checking its signature. Both are promises about *other files*: the
 * Dockerfile that pins the base the offer names, the release workflow that signs under the
 * identity the page tells a user to accept, the assets the release attaches. Nothing else
 * reads the page, and a command in it that no longer matches the workflow fails for the one
 * person who runs it to decide whether to trust an image.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (...segments: string[]): string => readFileSync(join(ROOT, ...segments), 'utf8')
const flat = (text: string): string => text.replace(/\s+/g, ' ')

const PAGE = join('docs', 'IMAGE-SOURCES.md')
const page = read(PAGE)
const prose = flat(page)
const release = read('.github', 'workflows', 'release.yml')

describe('the base image', () => {
  const froms = read('Dockerfile')
    .split('\n')
    .filter((line) => /^FROM node:/.test(line))

  it('is pinned by digest in both stages that start from it, so that the offer can name one Debian', () => {
    expect(froms, 'the stages that start from node').toHaveLength(2)
    for (const line of froms) {
      expect(line, line).toMatch(/^FROM node:\d+-bookworm-slim@sha256:[0-9a-f]{64} AS \w+$/)
    }
  })

  it('is the same digest in both, because what builds the native modules has to be what runs them', () => {
    const digests = froms.map((line) => /@(sha256:[0-9a-f]{64})/.exec(line)?.[1])

    expect(new Set(digests).size).toBe(1)
  })

  it('is named on the page, as pinned in the Dockerfile', () => {
    expect(prose).toContain('pinned by digest')
    expect(prose).toContain('node:24-bookworm-slim')
  })
})

describe('what the page says the image carries', () => {
  it('names the GPL and LGPL parts, and where each comes from', () => {
    expect(prose).toContain('ffmpeg')
    expect(prose).toContain('libx264')
    expect(prose).toContain('GPL-2.0-or-later')
    expect(prose).toContain('libvips')
    expect(prose).toContain('@img/sharp-libvips-linux-<arch>')
    expect(prose).toContain('LGPL-3.0-or-later')
    // libvips is not Debian's here: it is the build `sharp` loads from npm. A page that
    // sent a reader to Debian for it would send them to a package the image does not have.
    expect(prose).toContain('not Debian')
  })

  it('says the same about libvips as NOTICE does', () => {
    const notice = flat(read('NOTICE'))

    expect(notice).toContain('@img/sharp-libvips-*')
    expect(notice).toContain('LGPL-3.0-or-later')
    expect(notice).toContain('ffmpeg')
  })

  it('makes a written offer that lasts at least three years, and says how to ask', () => {
    expect(prose).toContain('for at least **three years** after that release is published')
    expect(prose).toContain('https://github.com/Irony42/EventSlide/issues')
  })

  it('tells a reader where Debian keeps its sources, version by version', () => {
    expect(page).toContain('apt-get source ffmpeg=')
    expect(page).toContain('https://snapshot.debian.org/package/ffmpeg/')
  })
})

describe('the files the page says every release attaches', () => {
  const script = release.slice(release.indexOf('Create the release, or add to the one'))

  it('are the ones the release workflow attaches, under the same names', () => {
    expect(page).toContain('`image-sources-X.Y.Z.txt`')
    expect(page).toContain('`eventslide-X.Y.Z.spdx.json`')
    expect(script).toContain('"eventslide-$VERSION.spdx.json" "image-sources-$VERSION.txt"')
    expect(script).toContain('cp docs/IMAGE-SOURCES.md IMAGE-SOURCES.md')
    expect(prose).toContain('The page is attached to every GitHub release')
  })

  it('are written by the workflow from the image that was pushed, and say what the page says they do', () => {
    expect(release).toContain('echo "== libvips"')
    expect(release).toContain('echo "== Debian packages"')
    expect(page).toContain('== libvips')
  })
})

describe('the signature the page tells a user to check', () => {
  /** The `--certificate-identity-regexp` value, as the page and the workflow each write it. */
  const identityIn = (text: string): string | undefined =>
    /(?:--certificate-identity-regexp\s+'|identity=')([^']+)'/.exec(text)?.[1]

  it('is under the identity the release workflow itself verifies, word for word', () => {
    expect(identityIn(page), 'the identity on the page').toBeDefined()
    expect(identityIn(release), 'the identity in the workflow').toBeDefined()
    expect(identityIn(page)).toBe(identityIn(release))
  })

  it('is issued by GitHub Actions, as the workflow and the page both say', () => {
    const issuer = 'https://token.actions.githubusercontent.com'

    expect(page).toContain(`--certificate-oidc-issuer ${issuer}`)
    expect(release).toContain(`issuer='${issuer}'`)
  })

  it('is checked on a digest, and the page says why', () => {
    expect(page).toContain('ghcr.io/irony42/eventslide@sha256:')
    expect(prose).toContain('Check the digest you run, not a tag')
  })

  it('is not claimed for an image built from the checkout', () => {
    expect(prose).toContain('has no signature')
    expect(read('compose.build.yaml')).toContain('It is not signed')
  })
})

/** GitHub's anchor for a heading: lower case, no punctuation, hyphens for spaces. */
const anchorOf = (heading: string): string =>
  heading
    .replace(/`/g, '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')

const anchorsIn = (file: string): readonly string[] =>
  [...read(file).matchAll(/^#{1,6} (.+)$/gm)].map((match) => anchorOf(match[1] ?? ''))

describe('the links of docs/IMAGE-SOURCES.md', () => {
  const links = [...page.matchAll(/\]\((?!https?:|mailto:)([^)\s]+)\)/g)].map(
    (match) => match[1] ?? '',
  )

  it('go to files that exist, and to headings that exist in them', () => {
    expect(links.length, 'relative links on the page').toBeGreaterThan(3)
    for (const link of links) {
      const [path = '', anchor] = link.split('#')
      const target = join('docs', path)

      expect(existsSync(resolve(ROOT, target)), link).toBe(true)
      if (anchor !== undefined) {
        expect(anchorsIn(target), `${link}: a heading of ${target}`).toContain(anchor)
      }
    }
  })

  it('reach the workflow, the verification script and the security policy', () => {
    expect(links).toContain('../.github/workflows/release.yml')
    expect(links).toContain('../scripts/verify-image.sh')
    expect(links.some((link) => link.startsWith('SECURITY.md#'))).toBe(true)
  })
})

describe('the places that must point at docs/IMAGE-SOURCES.md', () => {
  it.each(['README.md', 'docs/UPGRADING.md'])('%s links it', (file) => {
    expect(read(...file.split('/'))).toMatch(/\]\((docs\/)?IMAGE-SOURCES\.md[)#]/)
  })

  it('the Dockerfile says why its base is pinned, and names the page and the test', () => {
    const dockerfile = read('Dockerfile')

    expect(dockerfile).toContain('docs/IMAGE-SOURCES.md')
    expect(dockerfile).toContain('scripts/imageSources.test.ts')
  })
})
