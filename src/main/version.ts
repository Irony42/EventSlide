import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'

/**
 * The product's one version, read from the `package.json` that names it.
 *
 * It used to be written down three times — `container.ts`, `scripts/backup.ts` and the
 * image tag in `compose.yaml` — and a release bumped whichever one somebody remembered
 * (roadmap G1-04 / finding A-04). `/api/health`, `/api/about`, the backup manifest and the
 * default source link are now all this value.
 *
 * ## Why a walk, and not the obvious answers
 *
 * - **Not an import of `package.json`.** `tsconfig.build.json` has `rootDir: src`, so a
 *   file outside it is `error TS6059`.
 * - **Not a fixed `../..`.** This module runs from four depths: `src/main` under `tsx`,
 *   `dist/server/main` in the server build, `dist/ops/src/main` in the operator commands
 *   (`tsconfig.ops.json` has `rootDir: '.'`, one level deeper) and `/app/dist/server/main`
 *   in the image, where `package.json` is copied beside `dist/`. A relative path is right
 *   for one of them.
 * - **Not `process.cwd()`.** It is wherever the operator happened to `cd`, and
 *   `scripts/purge.ts` is documented as runnable from anywhere.
 *
 * So it starts at `__dirname` and climbs to the first manifest that names the product.
 * `__dirname` and not `import.meta`: the server is CommonJS (CLAUDE.md §9 trap 8), where
 * `import.meta` does not exist.
 *
 * ## Why it throws
 *
 * Nothing falls back to `'0.0.0'` or `'unknown'`. The version is the default of the source
 * link AGPL §13 obliges the box to offer, so a wrong value there is a wrong answer in the
 * one place that has legal weight, and a boot that cannot tell is better refused.
 */

/**
 * The names the manifest of this code carries: the application itself, and the core when
 * it is installed as a library another program composes.
 */
const OWN_PACKAGE_NAMES: ReadonlySet<string> = new Set(['eventslide', '@eventslide/core'])

/**
 * Semver, with an optional pre-release and build part. Narrow on purpose: the value is
 * interpolated into a URL path (`/tree/v${version}`) and printed on a public endpoint, so
 * a manifest whose `version` is `1.0.0/../../x` is refused rather than trusted.
 */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const nameOnly = z.object({ name: z.string() })

const ownManifest = z.object({
  name: z.string(),
  version: z.string().regex(SEMVER, 'is not a semantic version'),
})

/** What a directory's `package.json` is, or `null` when there is none or it is not JSON. */
const readManifest = (dir: string): unknown => {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as unknown
  } catch {
    // Absent, unreadable or not JSON: in each case this directory is not shown to be the
    // product's, and the walk goes on. A manifest that *is* the product's and is damaged
    // surfaces below as "no manifest of the product found", naming where it started.
    return null
  }
}

/**
 * The version of the nearest enclosing `package.json` that names the product, starting at
 * `startDir`.
 *
 * Exported for `version.test.ts`, which reproduces the four depths above in a temp
 * directory; the application calls {@link appVersion}.
 */
export const findPackageVersion = (startDir: string): string => {
  let dir = resolve(startDir)

  for (;;) {
    const manifest = readManifest(dir)
    const named = nameOnly.safeParse(manifest)

    if (named.success && OWN_PACKAGE_NAMES.has(named.data.name)) {
      const parsed = ownManifest.safeParse(manifest)
      if (!parsed.success) {
        throw new Error(
          `${join(dir, 'package.json')} names the product but its version is unusable: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.')} ${issue.message}`)
            .join('; ')}`,
        )
      }
      return parsed.data.version
    }

    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(
        `no package.json naming ${[...OWN_PACKAGE_NAMES].join(' or ')} was found at or above ${resolve(startDir)}`,
      )
    }
    dir = parent
  }
}

let cached: string | undefined

/**
 * This build's version. Resolved on first use and then kept: the manifest cannot change
 * under a running process, and `/api/about` is public, so it is asked for per request in
 * principle and must not read a file each time.
 */
export const appVersion = (): string => {
  cached ??= findPackageVersion(__dirname)
  return cached
}
