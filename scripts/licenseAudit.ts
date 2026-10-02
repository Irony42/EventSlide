import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

/**
 * The dependency licence audit (roadmap G1-07 / P1-09).
 *
 * EventSlide is AGPL-3.0-only (`LICENSE`), and the maintainer keeps the right to license
 * their own work on other terms too (`docs/CLA.md` grants it). Both are only true while no
 * dependency that ships with the product asks for more than a notice in return. So this is
 * an **allow-list**, not a deny-list: a licence nobody has read is refused until somebody
 * does, and the day somebody does, the decision is written down here with its reason.
 *
 * A deny-list fails the way a `.gitignore` does. The licence you did not think of passes
 * silently; the allow-list's failure is a red test that names the package.
 *
 * Three rules, each with a test in `licenseAudit.test.ts` that goes red without it:
 *
 * 1. **Every package in `package-lock.json` is audited**, not only the ones that
 *    `package.json` names. A licence arrives with a transitive dependency of a transitive
 *    dependency, and the lockfile is the one file that lists them all.
 * 2. **A licence outside {@link ALLOWED_LICENSES} is refused**, unless an entry of
 *    {@link EXCEPTIONS} names that package, that exact licence and that scope. An exception
 *    for a development-only tool stops applying the moment the package becomes a
 *    production dependency, because "we only run it on a laptop" is the whole argument.
 * 3. **A licence that cannot be read is refused**, never skipped. The lockfile carries a
 *    `license` for most packages and not all of them; for the rest the installed
 *    `package.json` is read, and only when it is the version the lockfile names. A package
 *    that is neither readable nor in {@link RECORDED_LICENSES} is a failure, because "I
 *    could not look" is not "it is fine".
 *
 * Nothing here touches the network, and nothing here installs anything.
 */

/** Whether a package can end up in the published image. */
export type Scope = 'production' | 'development'

/**
 * The licences that need nothing from us beyond keeping their notice, which is what the
 * web build's `third-party-licenses.txt` does for what it bundles. Every one is permissive,
 * and every one combines with AGPL-3.0 (FSF's GPL-compatibility list for MIT, ISC, BSD and
 * 0BSD; Apache-2.0 since GPLv3).
 *
 * `MIT-0` (MIT without the notice condition) is here for `nodemailer` 10, which arrives
 * with the mailer (roadmap G2-07), and for two development packages already in the tree.
 *
 * Adding to this list is a licensing decision: the commit that does it says why.
 */
export const ALLOWED_LICENSES: readonly string[] = [
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MIT',
  'MIT-0',
]

export interface LicenseException {
  /** The package name, as the lockfile spells it. */
  readonly packages: RegExp
  /** The exact SPDX expressions this exception covers. Any other licence is not excused. */
  readonly licenses: readonly string[]
  /**
   * `development` means the exception holds only while the lockfile marks the package
   * `dev: true`, i.e. while `npm prune --omit=dev` removes it from the image.
   */
  readonly scope: Scope
  /**
   * What `NOTICE` must contain for a production exception, because someone downstream of
   * a copyleft component is entitled to be told it is there. Unused for `development`.
   */
  readonly named?: string
  readonly reason: string
}

/**
 * Licences outside the allow-list that have been read and accepted, one entry each.
 *
 * An exception that matches nothing in the lockfile is itself a failure (the package left
 * and the entry stayed), so this list can only shrink by deletion and never rots.
 */
export const EXCEPTIONS: readonly LicenseException[] = [
  {
    packages: /^@img\/sharp-/,
    licenses: [
      'LGPL-3.0-or-later',
      'Apache-2.0 AND LGPL-3.0-or-later',
      'Apache-2.0 AND LGPL-3.0-or-later AND MIT',
    ],
    scope: 'production',
    named: '@img/sharp-libvips-',
    reason:
      'sharp is Apache-2.0; the libvips it loads is LGPL-3.0-or-later, shipped as a separate ' +
      'shared library that an operator can replace, which is what LGPL section 4 asks of a ' +
      'combined work, and LGPL-3.0 combines with AGPL-3.0 (GPL-3.0 section 13). NOTICE names it.',
  },
  {
    packages: /^(?:@axe-core\/playwright|axe-core)$/,
    licenses: ['MPL-2.0'],
    scope: 'development',
    reason:
      'The accessibility checks of the end-to-end suite. File-level copyleft, nothing here ' +
      'is modified or redistributed, and `npm prune --omit=dev` keeps it out of the image.',
  },
  {
    packages: /^lightningcss(?:-[a-z0-9-]+)?$/,
    licenses: ['MPL-2.0'],
    scope: 'development',
    reason:
      'The CSS transformer Vite runs while building. Its output is our stylesheet, which the ' +
      'MPL does not cover; the tool itself stays on the build machine.',
  },
  {
    packages: /^ffmpeg-static$/,
    licenses: ['GPL-3.0-or-later'],
    scope: 'development',
    reason:
      'A convenience binary so the video tests run on a laptop with nothing installed. The ' +
      'image installs Debian ffmpeg and runs it as a separate process (Dockerfile; ' +
      '`ffmpegBinaries.ts` resolves this package without importing it). Moving it to ' +
      '`dependencies` turns this exception off, on purpose.',
  },
  {
    packages: /^caniuse-lite$/,
    licenses: ['CC-BY-4.0'],
    scope: 'development',
    reason:
      'Browser-support data read by the build tooling. It asks for attribution, nothing ' +
      'from it is served, and it is pruned from the image.',
  },
  {
    packages: /^mdn-data$/,
    licenses: ['CC0-1.0'],
    scope: 'development',
    reason: 'CSS reference data read by the build tooling: a public-domain dedication, pruned.',
  },
]

export interface RecordedLicense {
  /** `name@version`: one release, never a range. */
  readonly package: string
  readonly license: string
  readonly reason: string
}

/**
 * Licences a person read, for packages whose own metadata cannot be used as it stands.
 * Keyed by name **and version**: a new release has to be read again. Only for a package the
 * lockfile states no licence for, and a human reading beats the machine-readable field.
 *
 * - `fsevents` is macOS-only, so `npm ci` skips it on Linux (CI) and on Windows alike and
 *   there is nothing to read. It is `dev: true`, the optional file watcher of the
 *   development server, so it never reaches the image.
 * - `parse-cache-control` declares the legacy word `BSD`, which is not a licence
 *   identifier. Its LICENSE file is the three-clause text. A development dependency.
 */
export const RECORDED_LICENSES: readonly RecordedLicense[] = [
  {
    package: 'fsevents@2.3.3',
    license: 'MIT',
    reason: 'macOS-only optional dependency of the development file watcher; MIT upstream.',
  },
  {
    package: 'parse-cache-control@1.0.1',
    license: 'BSD-3-Clause',
    reason:
      'Declares the legacy "BSD"; its LICENSE is the three-clause text (Walmart and other contributors).',
  },
]

export interface LicensePolicy {
  readonly allowed: readonly string[]
  readonly exceptions: readonly LicenseException[]
  readonly recorded: readonly RecordedLicense[]
}

export const POLICY: LicensePolicy = {
  allowed: ALLOWED_LICENSES,
  exceptions: EXCEPTIONS,
  recorded: RECORDED_LICENSES,
}

/**
 * Licences no exception can excuse: they restrict what the operator may do with the
 * running service (SSPL, BUSL, Elastic, Commons Clause, PolyForm), reach the network the
 * way AGPL does, or are not a licence at all (`UNLICENSED`, a `LicenseRef`, "SEE LICENSE
 * IN ...").
 */
const NEVER_EXCUSED =
  /^(?:SSPL|BUSL|Elastic|Commons-Clause|PolyForm|AGPL|UNLICENSED|LicenseRef|SEE\b)/i

export const isNeverExcused = (id: string): boolean => NEVER_EXCUSED.test(id)

// ---------------------------------------------------------------------------------------
// SPDX expressions. `(MIT OR Apache-2.0)`, `Apache-2.0 AND LGPL-3.0-or-later`.
// ---------------------------------------------------------------------------------------

type Expression =
  | { readonly kind: 'id'; readonly id: string }
  | { readonly kind: 'and' | 'or'; readonly left: Expression; readonly right: Expression }

const TOKEN = /^(\(|\)|[A-Za-z0-9][A-Za-z0-9.+:-]*)\s*/

const tokenize = (text: string): string[] | undefined => {
  const tokens: string[] = []
  let rest = text.trim()
  while (rest !== '') {
    const match = TOKEN.exec(rest)
    const token = match?.[1]
    if (match === null || token === undefined) return undefined
    tokens.push(token)
    rest = rest.slice(match[0].length)
  }
  return tokens
}

const isKeyword = (token: string | undefined, keyword: 'AND' | 'OR' | 'WITH'): boolean =>
  token?.toUpperCase() === keyword

const isOperand = (token: string | undefined): token is string =>
  token !== undefined &&
  token !== '(' &&
  token !== ')' &&
  !isKeyword(token, 'AND') &&
  !isKeyword(token, 'OR') &&
  !isKeyword(token, 'WITH')

/**
 * `undefined` for anything that is not a well-formed SPDX expression, which the audit
 * then refuses: a free-text licence field cannot be checked against a list.
 *
 * `AND` binds tighter than `OR`, as in the specification. `id WITH exception` is kept as
 * one identifier, `"GPL-2.0-only WITH Classpath-exception-2.0"`, so it matches the
 * allow-list only if that whole string is on it, which no `WITH` form is.
 */
export const parseExpression = (text: string): Expression | undefined => {
  const tokens = tokenize(text)
  if (tokens === undefined) return undefined
  let at = 0

  const parseAtom = (): Expression | undefined => {
    const token = tokens[at]
    if (token === '(') {
      at += 1
      const inner = parseOr()
      if (inner === undefined || tokens[at] !== ')') return undefined
      at += 1
      return inner
    }
    if (!isOperand(token)) return undefined
    at += 1
    if (!isKeyword(tokens[at], 'WITH')) return { kind: 'id', id: token }
    const exception = tokens[at + 1]
    if (!isOperand(exception)) return undefined
    at += 2
    return { kind: 'id', id: `${token} WITH ${exception}` }
  }

  const parseAnd = (): Expression | undefined => {
    let left = parseAtom()
    while (left !== undefined && isKeyword(tokens[at], 'AND')) {
      at += 1
      const right = parseAtom()
      if (right === undefined) return undefined
      left = { kind: 'and', left, right }
    }
    return left
  }

  const parseOr = (): Expression | undefined => {
    let left = parseAnd()
    while (left !== undefined && isKeyword(tokens[at], 'OR')) {
      at += 1
      const right = parseAnd()
      if (right === undefined) return undefined
      left = { kind: 'or', left, right }
    }
    return left
  }

  const parsed = parseOr()
  return parsed !== undefined && at === tokens.length ? parsed : undefined
}

const identifiersOf = (expression: Expression): string[] =>
  expression.kind === 'id'
    ? [expression.id]
    : [...identifiersOf(expression.left), ...identifiersOf(expression.right)]

/** `A OR B` is the licensee's choice, so one acceptable side is enough; `A AND B` is both. */
const accepts = (expression: Expression, allowed: ReadonlySet<string>): boolean => {
  if (expression.kind === 'id') return allowed.has(expression.id.toLowerCase())
  return expression.kind === 'or'
    ? accepts(expression.left, allowed) || accepts(expression.right, allowed)
    : accepts(expression.left, allowed) && accepts(expression.right, allowed)
}

const sameExpression = (a: string, b: string): boolean =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()

// ---------------------------------------------------------------------------------------
// What a manifest says. `package.json` has said it three ways over the years.
// ---------------------------------------------------------------------------------------

const licenseEntry = z.union([z.string(), z.object({ type: z.string() })])

/**
 * The licence a `package.json` (or a lockfile entry) declares, as one SPDX string, or
 * `undefined` if it declares none that can be read: the `license` string, the legacy
 * `{ "type": ... }` object, or the legacy `licenses` array, which npm reads as a choice.
 */
export const declaredLicense = (manifest: {
  readonly license?: unknown
  readonly licenses?: unknown
}): string | undefined => {
  const single = licenseEntry.safeParse(manifest.license)
  if (single.success) {
    const text = (typeof single.data === 'string' ? single.data : single.data.type).trim()
    return text === '' ? undefined : text
  }
  const several = z.array(licenseEntry).min(1).safeParse(manifest.licenses)
  if (!several.success) return undefined
  const types = several.data.map((item) => (typeof item === 'string' ? item : item.type).trim())
  if (types.some((type) => type === '')) return undefined
  return types.length === 1 ? types[0] : `(${types.join(' OR ')})`
}

const manifestSchema = z
  .object({ version: z.string().optional(), license: z.unknown(), licenses: z.unknown() })
  .passthrough()

const lockfileSchema = z.object({
  packages: z.record(
    z.string(),
    z
      .object({
        name: z.string().optional(),
        version: z.string().optional(),
        license: z.unknown(),
        licenses: z.unknown(),
        dev: z.boolean().optional(),
        link: z.boolean().optional(),
      })
      .passthrough(),
  ),
})

export interface LockedPackage {
  /** The lockfile key, `node_modules/a/node_modules/b`, which is also the path on disk. */
  readonly key: string
  readonly name: string
  readonly version: string
  readonly scope: Scope
  /** What the lockfile itself says; absent for roughly a fifth of the entries. */
  readonly license: string | undefined
}

const NODE_MODULES = 'node_modules/'

/**
 * Every package the lockfile installs. `dev: true` is npm's own flag for "only reachable
 * through `devDependencies`", i.e. removed by `npm prune --omit=dev`; everything else,
 * including optional and peer dependencies, is treated as shipped.
 *
 * Throws on a lockfile that is not the shape npm writes, rather than auditing nothing.
 */
export const lockedPackages = (lockfile: unknown): LockedPackage[] => {
  const parsed = lockfileSchema.parse(lockfile)
  const found: LockedPackage[] = []
  for (const [key, entry] of Object.entries(parsed.packages)) {
    // The root is this project, and a `link` is a symlink whose target has an entry of its own.
    if (key === '' || entry.link === true) continue
    const at = key.lastIndexOf(NODE_MODULES)
    found.push({
      key,
      name: entry.name ?? (at === -1 ? key : key.slice(at + NODE_MODULES.length)),
      version: entry.version ?? 'unknown',
      scope: entry.dev === true ? 'development' : 'production',
      license: declaredLicense(entry),
    })
  }
  return found
}

/** The installed `package.json` for a lockfile key, or `undefined` when there is none. */
export type ManifestReader = (key: string) => unknown

export const installedManifests =
  (root: string): ManifestReader =>
  (key) => {
    try {
      return JSON.parse(readFileSync(join(root, key, 'package.json'), 'utf8')) as unknown
    } catch {
      return undefined
    }
  }

// ---------------------------------------------------------------------------------------
// The audit.
// ---------------------------------------------------------------------------------------

export type Source = 'lockfile' | 'installed' | 'recorded'

export interface Verdict {
  readonly package: LockedPackage
  /** The licence that was judged; `undefined` if it could not be read. */
  readonly license: string | undefined
  readonly source: Source | undefined
  readonly status: 'allowed' | 'excepted' | 'refused'
  readonly why: string
  /** The exception that excused it, when `status` is `excepted`. */
  readonly exception?: LicenseException
}

interface Resolved {
  readonly license: string | undefined
  readonly source: Source | undefined
  /** Why there is no licence, when there is none. */
  readonly missing?: string
}

const resolveLicense = (
  pkg: LockedPackage,
  read: ManifestReader,
  policy: LicensePolicy,
): Resolved => {
  if (pkg.license !== undefined) return { license: pkg.license, source: 'lockfile' }

  const recorded = policy.recorded.find((r) => r.package === `${pkg.name}@${pkg.version}`)
  if (recorded !== undefined) return { license: recorded.license, source: 'recorded' }

  const installed = manifestSchema.safeParse(read(pkg.key))
  let missing = 'is not installed here'
  if (installed.success) {
    if (installed.data.version === pkg.version) {
      const license = declaredLicense(installed.data)
      if (license !== undefined) return { license, source: 'installed' }
      missing = 'is installed, and its package.json declares no licence'
    } else {
      // A stale `node_modules` describes another release. Its licence is not this one's.
      missing = `is installed at ${installed.data.version ?? 'an unknown version'}, not the locked ${pkg.version}; run npm ci`
    }
  }
  return {
    license: undefined,
    source: undefined,
    missing: `the lockfile states no licence for it and it ${missing}`,
  }
}

const judge = (pkg: LockedPackage, resolved: Resolved, policy: LicensePolicy): Verdict => {
  const { license, source } = resolved
  const refuse = (why: string): Verdict => ({
    package: pkg,
    license,
    source,
    status: 'refused',
    why,
  })

  if (license === undefined) return refuse(resolved.missing ?? 'declares no licence')
  const expression = parseExpression(license)
  if (expression === undefined)
    return refuse(`declares ${JSON.stringify(license)}, which is not an SPDX expression`)

  const allowed = new Set(policy.allowed.map((id) => id.toLowerCase()))
  if (accepts(expression, allowed)) {
    return { package: pkg, license, source, status: 'allowed', why: 'on the allow-list' }
  }

  const ids = identifiersOf(expression)
  const never = ids.find(isNeverExcused)
  if (never !== undefined) {
    return refuse(
      `declares ${license}: ${never} can never be excused, in production or in development`,
    )
  }
  const exception = policy.exceptions.find(
    (candidate) =>
      candidate.packages.test(pkg.name) &&
      candidate.licenses.some((covered) => sameExpression(covered, license)) &&
      (candidate.scope === 'production' || pkg.scope === 'development'),
  )
  if (exception !== undefined) {
    return { package: pkg, license, source, status: 'excepted', why: exception.reason, exception }
  }
  const covering = policy.exceptions.find(
    (candidate) =>
      candidate.packages.test(pkg.name) &&
      candidate.licenses.some((covered) => sameExpression(covered, license)),
  )
  return refuse(
    covering === undefined
      ? `declares ${license}, which is not on the allow-list and has no exception`
      : `declares ${license}, excused only while it is a development dependency, and it now ships`,
  )
}

/** One verdict per locked package, in lockfile order. */
export const auditLockfile = (
  lockfile: unknown,
  read: ManifestReader,
  policy: LicensePolicy = POLICY,
): Verdict[] =>
  lockedPackages(lockfile).map((pkg) => judge(pkg, resolveLicense(pkg, read, policy), policy))

/** One line per refusal, naming the package, its scope and what is wrong with it. */
export const describeRefusals = (verdicts: readonly Verdict[]): string[] =>
  verdicts
    .filter((verdict) => verdict.status === 'refused')
    .map(({ package: pkg, why }) => `${pkg.name}@${pkg.version} (${pkg.scope}, ${pkg.key}): ${why}`)
