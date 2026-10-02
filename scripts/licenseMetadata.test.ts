import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Guards the AGPL-3.0-only relicence, asserted rather than described.
 *
 * Every fact checked here was, at some point, one line someone could edit without
 * noticing the others: `package.json`'s `license`, the lockfile root's `license`, the
 * Dockerfile's OCI label and `LICENSE` itself are four independent places that have to say
 * the same thing, and nothing in the toolchain fails the build if one of them drifts. That
 * is the shape of the `.github/dependabot.yml` `package-ecosystem` typo this repository
 * already learned from (see `scripts/dependabotConfig.test.ts`): no error, no warning, just
 * a declaration that stops matching the grant.
 *
 * `LICENSE` is checked by git blob hash rather than by content, on purpose: a hash cannot
 * pass by accident the way a substring match can. A modified file that still contains the
 * words "GNU Affero" would pass a content check and must not pass this one.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The git blob SHA-1 of the AGPL-3.0 text byte for byte as served by
 * https://www.gnu.org/licenses/agpl-3.0.txt (34523 bytes, 661 lines). It is also the blob
 * of the `LICENSE` file in grafana/grafana.
 *
 * A second widely used blob, `0ad25db4bd1d86c452db3f9602ccdbe172438f52`, is GitHub's own
 * rendering of the AGPL-3.0, served by its licence API and by choosealicense.com. It has
 * the same 661 lines but one line of the optional "How to Apply" appendix wraps
 * differently, so it is not the Free Software Foundation's file. The README and NOTICE
 * promise the FSF's text unmodified, so that is what is pinned here: a `LICENSE` copied
 * from GitHub fails this test, deliberately.
 */
const AGPL_3_0_BLOB_SHA = 'be3f7b28e564e7dd05eaf59d64adba1a4065ac0e'

/** A git blob SHA-1, computed the same way `git hash-object` does — no git binary needed. */
const gitBlobSha1 = (contents: Buffer): string =>
  createHash('sha1').update(`blob ${contents.length}\0`).update(contents).digest('hex')

const read = (...path: string[]): string => readFileSync(join(ROOT, ...path), 'utf8')

describe('license metadata agrees everywhere it is declared', () => {
  it('ships the unmodified, canonical AGPL-3.0 text as LICENSE', () => {
    const licenseBytes = readFileSync(join(ROOT, 'LICENSE'))

    expect(gitBlobSha1(licenseBytes)).toBe(AGPL_3_0_BLOB_SHA)
  })

  it('declares AGPL-3.0-only in package.json', () => {
    const pkg = JSON.parse(read('package.json')) as { license?: unknown }

    expect(pkg.license).toBe('AGPL-3.0-only')
  })

  it('declares AGPL-3.0-only at the package-lock.json root', () => {
    const lockfile = JSON.parse(read('package-lock.json')) as {
      packages?: Record<string, { license?: unknown }>
    }

    expect(lockfile.packages?.['']?.license).toBe('AGPL-3.0-only')
  })

  it('labels the image that is actually published, once, AGPL-3.0-only', () => {
    // Docker keeps the last LABEL with a given key, and only the final stage becomes the
    // image. A label on `deps` or `build` describes nothing anyone pulls, and a second
    // one further down would override this one without a word.
    const dockerfile = read('Dockerfile')
    const runtimeAt = dockerfile.search(/^FROM .* AS runtime$/m)
    expect(runtimeAt, 'a `FROM ... AS runtime` stage').toBeGreaterThanOrEqual(0)
    const runtime = dockerfile.slice(runtimeAt)

    expect(runtime.match(/^FROM /gm), 'runtime is the final stage').toHaveLength(1)
    expect(
      runtime
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .filter((line) => line.includes('org.opencontainers.image.licenses')),
    ).toEqual(['LABEL org.opencontainers.image.licenses=AGPL-3.0-only'])
  })

  it('ships a NOTICE that names the project, the copyright holder and the AGPL grant', () => {
    const notice = read('NOTICE').replace(/\s+/g, ' ')

    expect(notice).toContain('EventSlide')
    expect(notice).toContain('Copyright (C) 2023-2026 Pierre Tijou')
    expect(notice).toContain(
      'under the terms of the GNU Affero General Public License as published by the Free ' +
        'Software Foundation, version 3 of the License only (AGPL-3.0-only)',
    )
  })
})
