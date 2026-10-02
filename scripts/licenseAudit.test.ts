import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ALLOWED_LICENSES,
  EXCEPTIONS,
  POLICY,
  RECORDED_LICENSES,
  auditLockfile,
  declaredLicense,
  describeRefusals,
  installedManifests,
  isNeverExcused,
  lockedPackages,
  type ManifestReader,
} from './licenseAudit'

/**
 * The dependency licence audit (roadmap G1-07 / P1-09), asserted rather than described.
 *
 * EventSlide is AGPL-3.0-only and its maintainer keeps the right to license their own work
 * on other terms as well (the contributor licence agreement). That is only true while nothing that ships with
 * the product asks for more than a notice, and nothing in the toolchain looks: `npm install`
 * accepts any licence. Dependabot opens a pull request, the tests are green, and a
 * transitive package has changed from MIT to something with a network clause.
 *
 * Two halves, as in `licenseMetadata.test.ts`. The first audits **the real lockfile**: it
 * is the test that goes red on a pull request that adds or bumps a dependency. The second
 * audits **fixtures**, because a check that has only ever seen a clean tree has never been
 * seen to fail: each refusal below is a lockfile built to be refused, and the plan's own
 * criterion (a dependency under SSPL, in production, fails) is the first of them.
 *
 * The policy itself is `scripts/licenseAudit.ts`; this file never repeats a licence list
 * of its own except to prove one is on or off it.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const read = (...path: string[]): string => readFileSync(join(ROOT, ...path), 'utf8')

// ---------------------------------------------------------------------------------------
// The real lockfile.
// ---------------------------------------------------------------------------------------

describe('the lockfile this repository ships', () => {
  const lockfile: unknown = JSON.parse(read('package-lock.json'))
  const verdicts = auditLockfile(lockfile, installedManifests(ROOT))

  it('has no dependency outside the allow-list that is not an excused exception', () => {
    // Each line names the package, whether it ships, where it sits and what is wrong. On a
    // pull request that adds a dependency this is the failure the author reads.
    expect(describeRefusals(verdicts)).toEqual([])
  })

  it('audited every package the lockfile installs, not a sample', () => {
    // A lockfile parser that quietly returned nothing would pass the test above. The root
    // (this project) and `link` entries are the only things that may be left out.
    const entries = Object.entries(
      (lockfile as { packages: Record<string, { link?: boolean }> }).packages,
    ).filter(([key, entry]) => key !== '' && entry.link !== true)

    expect(entries.length).toBeGreaterThan(100)
    expect(verdicts).toHaveLength(entries.length)
  })

  it('judges the packages that ship and the ones that only build separately', () => {
    // Both scopes must exist in the tree, or the "development" half of the rules below is
    // being tested against a lockfile that does not exercise it.
    const scopes = new Set(verdicts.map((verdict) => verdict.package.scope))

    expect(scopes).toEqual(new Set(['production', 'development']))
  })

  it('excuses every exception it lists at least once, so none outlives its dependency', () => {
    const unused = EXCEPTIONS.filter(
      (exception) => !verdicts.some((verdict) => verdict.exception === exception),
    )

    expect(unused.map((exception) => String(exception.packages))).toEqual([])
  })

  it('records a licence only for a release that is locked and would not pass without it', () => {
    // A recorded licence is a person's reading standing in for metadata that cannot be
    // used. Once the version moves on, or the package states something the policy accepts
    // by itself, the entry is stale and must go.
    const without = auditLockfile(lockfile, installedManifests(ROOT), { ...POLICY, recorded: [] })
    const stale = RECORDED_LICENSES.filter((recorded) => {
      const verdict = without.find(
        (candidate) =>
          `${candidate.package.name}@${candidate.package.version}` === recorded.package,
      )
      return verdict === undefined || verdict.status === 'allowed' || verdict.status === 'excepted'
    })

    expect(stale.map((recorded) => recorded.package)).toEqual([])
  })

  it('leaves unverified only the packages that are development-only and optional', () => {
    // The one tolerance of the audit: a platform-gated build helper that is not installed
    // here (and so cannot be read) is reported, not refused. Nothing else may be.
    const unverified = verdicts.filter((verdict) => verdict.status === 'unverified')

    expect(
      unverified
        .filter((verdict) => verdict.package.scope !== 'development' || !verdict.package.optional)
        .map((verdict) => verdict.package.key),
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------
// The policy, as written.
// ---------------------------------------------------------------------------------------

describe('the policy', () => {
  it('lists only permissive licences as allowed', () => {
    // Copyleft is possible, but only as an exception that says why. Putting GPL on the
    // allow-list would make the next GPL package pass without anyone reading it.
    const copyleftOrWorse = ALLOWED_LICENSES.filter((id) =>
      /GPL|MPL|EPL|CDDL|OSL|EUPL|CC-BY|SSPL|BUSL|Elastic|Commons|PolyForm|Unlicensed|LicenseRef/i.test(
        id,
      ),
    )

    expect(copyleftOrWorse).toEqual([])
  })

  it('allows MIT-0, which nodemailer 10 is published under (roadmap G2-07)', () => {
    expect(ALLOWED_LICENSES).toContain('MIT-0')
  })

  it('gives every exception a reason of its own, long enough to be an argument', () => {
    const unexplained = EXCEPTIONS.filter((exception) => exception.reason.trim().length < 60)

    expect(unexplained.map((exception) => String(exception.packages))).toEqual([])
  })

  it('names every production exception in NOTICE, where a downstream user will look', () => {
    const notice = read('NOTICE')
    const unnamed = EXCEPTIONS.filter(
      (exception) =>
        exception.scope === 'production' &&
        (exception.named === undefined || !notice.includes(exception.named)),
    )

    expect(unnamed.map((exception) => String(exception.packages))).toEqual([])
  })

  it.each([
    'SSPL-1.0',
    'BUSL-1.1',
    'Elastic-2.0',
    'Commons-Clause',
    'PolyForm-Noncommercial-1.0.0',
    'AGPL-3.0-only',
    'AGPL-3.0-or-later',
    'UNLICENSED',
    'LicenseRef-custom',
  ])('puts %s beyond any exception', (id) => {
    expect(isNeverExcused(id)).toBe(true)
  })

  it.each(['MPL-2.0', 'GPL-3.0-or-later', 'LGPL-3.0-or-later', 'CC-BY-4.0', 'CC0-1.0'])(
    'leaves %s open to a named, argued exception',
    (id) => {
      expect(isNeverExcused(id)).toBe(false)
    },
  )

  it('excuses no licence that restricts the operator or reaches the network', () => {
    const excused = EXCEPTIONS.flatMap((exception) => exception.licenses).filter((license) =>
      license.split(/[\s()]+/).some(isNeverExcused),
    )

    expect(excused).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------
// Fixtures: lockfiles built to be refused.
// ---------------------------------------------------------------------------------------

interface Entry {
  readonly name?: string
  readonly version?: string
  readonly license?: unknown
  readonly licenses?: unknown
  readonly dev?: boolean
  readonly optional?: boolean
  readonly peer?: boolean
  readonly devOptional?: boolean
  readonly link?: boolean
}

/** A lockfile of the shape npm writes, with this project as its root. */
const lock = (packages: Record<string, Entry>): unknown => ({
  name: 'eventslide',
  lockfileVersion: 3,
  packages: { '': { name: 'eventslide', license: 'AGPL-3.0-only' }, ...packages },
})

/** A lockfile with one dependency, `name@version`, as the lockfile describes it. */
const one = (name: string, entry: Entry): unknown =>
  lock({ [`node_modules/${name}`]: { version: '1.0.0', ...entry } })

const nothingInstalled: ManifestReader = () => undefined

/** A `node_modules` holding exactly these manifests, by lockfile key. */
const installed =
  (manifests: Record<string, unknown>): ManifestReader =>
  (key) =>
    manifests[key]

const refusalsOf = (lockfile: unknown, read: ManifestReader = nothingInstalled): string[] =>
  describeRefusals(auditLockfile(lockfile, read))

describe('a dependency under a licence the project cannot take', () => {
  it('fails the audit when it is SSPL and ships to production (the plan’s own criterion)', () => {
    const refusals = refusalsOf(one('mongo-ish', { license: 'SSPL-1.0' }))

    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toMatch(/^mongo-ish@1\.0\.0 \(production, node_modules\/mongo-ish\):/)
    expect(refusals[0]).toContain('SSPL-1.0')
  })

  it.each([
    'SSPL-1.0',
    'BUSL-1.1',
    'AGPL-3.0-only',
    'AGPL-3.0-or-later',
    'GPL-3.0-only',
    'GPL-2.0-only',
    'LGPL-2.1-only',
    'MPL-2.0',
    'EUPL-1.2',
    'Elastic-2.0',
    'CC-BY-NC-4.0',
    'Commons-Clause',
    'UNLICENSED',
    'WTFPL',
  ])('refuses %s in production, where nothing excuses it', (license) => {
    expect(refusalsOf(one('some-pkg', { license }))).toHaveLength(1)
  })

  it.each(['SSPL-1.0', 'BUSL-1.1', 'AGPL-3.0-or-later', 'UNLICENSED'])(
    'refuses %s in a development dependency too, because no exception can name it',
    (license) => {
      const refusals = refusalsOf(one('some-tool', { license, dev: true }))

      expect(refusals).toHaveLength(1)
      expect(refusals[0]).toContain('can never be excused')
    },
  )

  it('gives a development dependency no blanket pass: an unlisted GPL tool is refused too', () => {
    // Development packages are not shipped, so their licences matter less, but "less" is
    // not "none": each one that is not allowed is read once and listed with its reason.
    const refusals = refusalsOf(one('some-tool', { license: 'GPL-3.0-only', dev: true }))

    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toContain('(development,')
  })
})

describe('a dependency under an allowed licence', () => {
  it.each(ALLOWED_LICENSES)('passes as %s', (license) => {
    expect(refusalsOf(one('some-pkg', { license }))).toEqual([])
  })

  it('passes nodemailer 10 under MIT-0, the mailer’s SMTP adapter (roadmap G2-07)', () => {
    const lockfile = lock({
      'node_modules/nodemailer': { version: '10.0.13', license: 'MIT-0' },
    })

    expect(refusalsOf(lockfile)).toEqual([])
  })

  it('does not care in which case an identifier is written', () => {
    expect(refusalsOf(one('old-pkg', { license: 'mit' }))).toEqual([])
  })
})

describe('an SPDX expression', () => {
  it.each([
    ['a choice with an allowed side', '(MIT OR GPL-3.0-only)'],
    ['a choice where only the other side is allowed', 'SSPL-1.0 OR Apache-2.0'],
    ['both sides allowed', '(Apache-2.0 AND MIT)'],
    ['AND binding tighter than OR', 'MIT OR GPL-3.0-only AND LGPL-2.1-only'],
    ['nested groups', '((BSD-2-Clause OR GPL-2.0-only) AND ISC)'],
    ['stray whitespace', '  MIT   OR   ISC '],
  ])('is accepted for %s', (_name, license) => {
    expect(refusalsOf(one('some-pkg', { license }))).toEqual([])
  })

  it.each([
    ['one side of an AND that is not allowed', 'MIT AND GPL-3.0-only'],
    ['a choice where neither side is allowed', 'GPL-3.0-only OR SSPL-1.0'],
    ['AND binding tighter than OR, the other way', '(MIT OR GPL-3.0-only) AND LGPL-2.1-only'],
    ['an exception clause, which is a different licence', 'Apache-2.0 WITH LLVM-exception'],
    ['an unbalanced parenthesis', '(MIT'],
    ['a closing parenthesis alone', 'MIT)'],
    ['a dangling operator', 'MIT OR'],
    ['a leading operator', 'OR MIT'],
    ['two identifiers and no operator', 'MIT ISC'],
    ['free text', 'SEE LICENSE IN LICENSE.md'],
    ['a slash instead of OR', 'MIT/GPL-3.0-only'],
    ['an empty string', ''],
  ])('is refused for %s', (_name, license) => {
    expect(refusalsOf(one('some-pkg', { license }))).toHaveLength(1)
  })

  it('is refused with the words “not an SPDX expression” when it cannot be read at all', () => {
    expect(refusalsOf(one('some-pkg', { license: '(MIT' }))[0]).toContain('not an SPDX expression')
  })
})

describe('a licence the lockfile does not state', () => {
  const key = 'node_modules/some-pkg'

  it('is read from the installed package.json when that is the locked version', () => {
    const read = installed({ [key]: { version: '1.0.0', license: 'ISC' } })

    expect(refusalsOf(lock({ [key]: { version: '1.0.0' } }), read)).toEqual([])
  })

  it('is refused when the installed package.json says something not allowed', () => {
    const read = installed({ [key]: { version: '1.0.0', license: 'GPL-3.0-only' } })

    expect(refusalsOf(lock({ [key]: { version: '1.0.0' } }), read)).toHaveLength(1)
  })

  it('is read from the legacy `{ type }` form', () => {
    const read = installed({ [key]: { version: '1.0.0', license: { type: 'MIT', url: 'x' } } })

    expect(refusalsOf(lock({ [key]: { version: '1.0.0' } }), read)).toEqual([])
  })

  it('is read from the legacy `licenses` array as a choice, and refused if no side is allowed', () => {
    const lockfile = lock({ [key]: { version: '1.0.0' } })
    const choice = installed({
      [key]: { version: '1.0.0', licenses: [{ type: 'MIT' }, { type: 'GPL-2.0-only' }] },
    })
    const none = installed({ [key]: { version: '1.0.0', licenses: [{ type: 'GPL-2.0-only' }] } })

    expect(refusalsOf(lockfile, choice)).toEqual([])
    expect(refusalsOf(lockfile, none)).toHaveLength(1)
  })

  it('is refused when what is installed is another release than the one locked', () => {
    // The shared `node_modules` of a developer's machine can be behind the lockfile. Its
    // licence is a statement about a release the lockfile did not choose.
    const read = installed({ [key]: { version: '0.9.0', license: 'MIT' } })
    const refusals = refusalsOf(lock({ [key]: { version: '1.0.0' } }), read)

    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toContain('installed at 0.9.0, not the locked 1.0.0; run npm ci')
  })

  it('is refused when the package is not installed and nothing records its licence', () => {
    const refusals = refusalsOf(lock({ [key]: { version: '1.0.0' } }))

    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toContain('is not installed here')
  })

  it('is refused when the installed package.json declares none', () => {
    const read = installed({ [key]: { version: '1.0.0' } })
    const refusals = refusalsOf(lock({ [key]: { version: '1.0.0' } }), read)

    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toContain('declares no licence')
  })

  it('is taken from the recorded table for a package no machine here can install', () => {
    // fsevents is macOS-only: absent on Linux and Windows, with no licence in the lockfile.
    const lockfile = lock({
      'node_modules/fsevents': { version: '2.3.3', dev: true },
    })

    expect(refusalsOf(lockfile)).toEqual([])
  })

  it('prefers what a person read over a legacy word like "BSD" in the package itself', () => {
    // parse-cache-control declares `BSD`, which is not an identifier: its LICENSE file is
    // the three-clause text, and the recorded table says so for that one release.
    const read = installed({
      'node_modules/parse-cache-control': { version: '1.0.1', licenses: [{ type: 'BSD' }] },
    })
    const at = (version: string): unknown =>
      lock({ 'node_modules/parse-cache-control': { version, dev: true } })

    expect(refusalsOf(at('1.0.1'), read)).toEqual([])
    expect(
      refusalsOf(
        at('1.0.2'),
        installed({
          'node_modules/parse-cache-control': { version: '1.0.2', licenses: [{ type: 'BSD' }] },
        }),
      ),
    ).toHaveLength(1)
  })

  it('is not taken from the recorded table for any other version of that package', () => {
    const lockfile = lock({
      'node_modules/fsevents': { version: '9.9.9', dev: true },
    })

    expect(refusalsOf(lockfile)).toHaveLength(1)
  })

  it('is overridden by a recorded reading, even when the lockfile states something unusable', () => {
    // "Apache 2.0" is not an identifier, so no exception could ever match it. The way out
    // is to read the package once and write the reading down, with its reason.
    const lockfile = lock({
      'node_modules/odd': { version: '1.0.0', license: 'Apache 2.0', dev: true },
    })
    const reading = { package: 'odd@1.0.0', license: 'Apache-2.0', reason: 'read its LICENSE' }

    expect(refusalsOf(lockfile)).toHaveLength(1)
    expect(
      describeRefusals(
        auditLockfile(lockfile, nothingInstalled, { ...POLICY, recorded: [reading] }),
      ),
    ).toEqual([])
  })
})

/**
 * The audit's one tolerance. A development-only, optional package that is not installed is a
 * platform-gated build helper (a file watcher for macOS, a WebAssembly binding): in no image,
 * on no machine of this platform, and the lockfile of a dependency bump can add one without a
 * licence field. Refusing it would turn a Dependabot pull request red for want of a platform
 * nobody runs. Everything that can be read is still judged, and nothing that ships is excused.
 */
describe('a licence-less package that is development-only, optional and not installed', () => {
  const key = 'node_modules/gated-helper'
  const statusOf = (entry: Entry, read: ManifestReader = nothingInstalled): string | undefined =>
    auditLockfile(lock({ [key]: { version: '1.0.0', ...entry } }), read)[0]?.status

  it('is reported as unverified instead of refused', () => {
    expect(statusOf({ dev: true, optional: true })).toBe('unverified')
  })

  it('is refused when it is not optional, because then it should have been installed', () => {
    expect(statusOf({ dev: true })).toBe('refused')
  })

  it('is refused when it is optional but not development-only, because it can ship', () => {
    expect(statusOf({ optional: true })).toBe('refused')
  })

  it('is refused when something is installed in its place that is not the locked release', () => {
    const read = installed({ [key]: { version: '0.9.0', license: 'MIT' } })

    expect(statusOf({ dev: true, optional: true }, read)).toBe('refused')
  })

  it('is judged, and refused, when it is installed and the licence it declares is not allowed', () => {
    const read = installed({ [key]: { version: '1.0.0', license: 'GPL-3.0-only' } })

    expect(statusOf({ dev: true, optional: true }, read)).toBe('refused')
  })
})

describe('an exception', () => {
  const sharpLibvips = 'node_modules/@img/sharp-libvips-linux-x64'

  it('excuses the LGPL libvips that sharp loads, in production, by exact licence', () => {
    const lockfile = lock({
      [sharpLibvips]: { version: '1.3.3', license: 'LGPL-3.0-or-later', optional: true },
    })
    const [verdict] = auditLockfile(lockfile, nothingInstalled)

    expect(verdict?.status).toBe('excepted')
    expect(verdict?.why).toContain('LGPL')
  })

  it('does not excuse the same package under a different licence', () => {
    const lockfile = lock({ [sharpLibvips]: { version: '1.3.3', license: 'LGPL-3.0-only' } })

    expect(refusalsOf(lockfile)).toHaveLength(1)
  })

  it('does not excuse the same licence on a different package', () => {
    const lockfile = lock({
      'node_modules/left-pad': { version: '1.0.0', license: 'LGPL-3.0-or-later' },
    })

    expect(refusalsOf(lockfile)).toHaveLength(1)
  })

  it.each([
    ['sharp-evil', 'LGPL-3.0-or-later', false],
    ['evil-sharp', 'LGPL-3.0-or-later', false],
    ['@img-evil/sharp-libvips-linux-x64', 'LGPL-3.0-or-later', false],
    ['@evil/@img/sharp-libvips-linux-x64', 'LGPL-3.0-or-later', false],
    ['evil-ffmpeg-static', 'GPL-3.0-or-later', true],
    ['ffmpeg-static-evil', 'GPL-3.0-or-later', true],
    ['evil-axe-core', 'MPL-2.0', true],
    ['axe-core-evil', 'MPL-2.0', true],
    ['evil-caniuse-lite', 'CC-BY-4.0', true],
    ['caniuse-lite-data', 'CC-BY-4.0', true],
    ['evil-mdn-data', 'CC0-1.0', true],
    ['mdn-data-extra', 'CC0-1.0', true],
    ['evil-lightningcss', 'MPL-2.0', true],
  ])('does not excuse the look-alike %s under %s', (name, license, dev) => {
    // Each exception is for one named package. A pattern that only has to *contain* the
    // name would excuse the next package whose name does.
    const lockfile = lock({ [`node_modules/${name}`]: { version: '1.0.0', license, dev } })

    expect(refusalsOf(lockfile)).toHaveLength(1)
  })

  it('excuses a development tool only while it is a development dependency', () => {
    // ffmpeg-static is GPL and runs on a laptop. Listing it under `dependencies` would put
    // a GPL binary in the image, and the exception was written for a different arrangement.
    const dev = lock({
      'node_modules/ffmpeg-static': { version: '5.3.0', license: 'GPL-3.0-or-later', dev: true },
    })
    const shipped = lock({
      'node_modules/ffmpeg-static': { version: '5.3.0', license: 'GPL-3.0-or-later' },
    })

    expect(refusalsOf(dev)).toEqual([])
    const refusals = refusalsOf(shipped)
    expect(refusals).toHaveLength(1)
    expect(refusals[0]).toContain('now ships')
  })
})

describe('reading a lockfile', () => {
  it('leaves out the root and symlinks, and audits everything else', () => {
    const lockfile = lock({
      'node_modules/a': { version: '1.0.0', license: 'MIT' },
      'node_modules/linked': { link: true },
    })

    expect(lockedPackages(lockfile).map((pkg) => pkg.name)).toEqual(['a'])
  })

  it('names a nested package by its own name, not its parent’s', () => {
    const lockfile = lock({
      'node_modules/a/node_modules/@scope/b': { version: '1.0.0', license: 'MIT' },
    })

    expect(lockedPackages(lockfile).map((pkg) => pkg.name)).toEqual(['@scope/b'])
  })

  it('names an aliased package by what it really is', () => {
    const lockfile = lock({
      'node_modules/alias': { name: 'real-name', version: '1.0.0', license: 'MIT' },
    })

    expect(lockedPackages(lockfile).map((pkg) => pkg.name)).toEqual(['real-name'])
  })

  it('treats only dev: true as development; optional, peer and devOptional ship', () => {
    // `devOptional` is npm's "reachable through a dev edge or an optional one", and the
    // optional edge can reach an image. Being unsure whether a package ships is shipping.
    const lockfile = lock({
      'node_modules/a': { version: '1.0.0', license: 'MIT', dev: true },
      'node_modules/b': { version: '1.0.0', license: 'MIT', optional: true },
      'node_modules/c': { version: '1.0.0', license: 'MIT', peer: true },
      'node_modules/d': { version: '1.0.0', license: 'MIT', devOptional: true },
      'node_modules/e': { version: '1.0.0', license: 'MIT', dev: true, optional: true },
    })

    expect(lockedPackages(lockfile).map((pkg) => pkg.scope)).toEqual([
      'development',
      'production',
      'production',
      'production',
      'development',
    ])
  })

  it('refuses a file that is not a lockfile instead of auditing nothing', () => {
    expect(() => lockedPackages({ name: 'eventslide' })).toThrow()
    expect(() => lockedPackages('not json')).toThrow()
  })

  it('reads a declared licence in each of the three shapes npm has used', () => {
    expect(declaredLicense({ license: 'MIT' })).toBe('MIT')
    expect(declaredLicense({ license: { type: 'ISC' } })).toBe('ISC')
    expect(declaredLicense({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe(
      '(MIT OR Apache-2.0)',
    )
    expect(declaredLicense({ licenses: [{ type: 'MIT' }] })).toBe('MIT')
    expect(declaredLicense({ license: '   ' })).toBeUndefined()
    expect(declaredLicense({ license: 42 })).toBeUndefined()
    expect(declaredLicense({ licenses: [] })).toBeUndefined()
    expect(declaredLicense({ licenses: [{ type: ' ' }] })).toBeUndefined()
    expect(declaredLicense({})).toBeUndefined()
  })
})
