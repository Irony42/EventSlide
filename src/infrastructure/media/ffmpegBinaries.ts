import { createRequire } from 'node:module'
import { accessSync, constants } from 'node:fs'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { runProcess } from './runProcess'

/**
 * Finding ffmpeg, and proving it can do the one job it is here for.
 *
 * Three sources, in order, and the order is the deployment story:
 *
 * 1. **`FFMPEG_PATH` / `FFPROBE_PATH`** from configuration. An operator who has put a
 *    build somewhere unusual, or who wants a specific one, says so — and a configured
 *    path that does not exist is a hard failure rather than a silent fallback, because
 *    the whole point of setting it was to choose.
 * 2. **`ffmpeg-static` / `ffprobe-static`**, if they are installed. They are
 *    **devDependencies**: `npm ci` alone then gives a runnable ring-3 suite on a laptop
 *    with nothing installed, on Windows and macOS alike, and `npm prune --omit=dev`
 *    keeps ninety megabytes of binaries out of the image. Resolved through
 *    `createRequire` rather than imported, precisely so that the pruned production
 *    container — where they are genuinely absent — does not fail to load this module.
 * 3. **`PATH`**, resolved to an absolute path here rather than handed to `spawn` as a
 *    bare name. The image installs `ffmpeg` from apt and this is the branch it takes.
 *
 * The `PATH` search is written out rather than left to `spawn` because of the rule in
 * `runProcess`: never `shell: true`. Without a shell, Node on Windows will not apply
 * `PATHEXT`, so `spawn('ffmpeg')` fails where `ffmpeg.exe` exists — and with a shell it
 * would be CVE-2024-27980. Resolving the absolute name is the third option.
 */

export interface FfmpegPaths {
  readonly ffmpeg: string
  readonly ffprobe: string
}

/**
 * `PATH` and `PATHEXT`, as values.
 *
 * They arrive from `env.ts` rather than being read here, because that module is the only
 * one in the repository allowed to touch `process.env` and lint enforces it. The rule is
 * not ceremony in this case either: a test can hand this module an empty search path and
 * prove the "no ffmpeg anywhere" branch without depending on what is installed on the
 * machine running the suite.
 */
export interface ExecutableSearch {
  /** The `PATH` variable, verbatim. Split on the platform's delimiter here. */
  readonly path: string
  /** The `PATHEXT` variable. Ignored off Windows. */
  readonly extensions: string
}

export interface BinaryOverrides {
  readonly ffmpegPath?: string | undefined
  readonly ffprobePath?: string | undefined
  readonly search: ExecutableSearch
}

/**
 * Resolution anchored at the working directory.
 *
 * Not `import.meta.url`: this project emits CommonJS (`module: node16`, no `"type"` in
 * `package.json` — CLAUDE.md trap 8), where `import.meta` does not exist. `node_modules`
 * sits beside the application in both a source checkout and the container, so the
 * working directory is the right anchor in either.
 */
const requireFrom = createRequire(join(process.cwd(), 'noop.cjs'))

const isExecutable = (candidate: string): boolean => {
  try {
    accessSync(candidate, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** `PATHEXT` on Windows; a single empty suffix everywhere else. */
const executableSuffixes = (search: ExecutableSearch): readonly string[] => {
  if (process.platform !== 'win32') return ['']
  const list = search.extensions === '' ? '.EXE;.CMD;.BAT' : search.extensions
  return ['', ...list.split(';').filter((suffix) => suffix.length > 0)]
}

const onPath = (name: string, search: ExecutableSearch): string | null => {
  const directories = search.path.split(delimiter).filter((entry) => entry !== '')
  const suffixes = executableSuffixes(search)
  for (const directory of directories) {
    for (const suffix of suffixes) {
      const candidate = resolve(join(directory, `${name}${suffix}`))
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}

/**
 * The bundled binary, if this install has one.
 *
 * `ffmpeg-static` default-exports the path; `ffprobe-static` exports `{ path }`. Both are
 * absent in the pruned image, which is why this is a `require` in a `try` rather than an
 * import at the top of the file.
 */
const fromStaticPackage = (packageName: string): string | null => {
  try {
    const loaded: unknown = requireFrom(packageName)
    const candidate =
      typeof loaded === 'string'
        ? loaded
        : typeof loaded === 'object' && loaded !== null && 'path' in loaded
          ? (loaded as { readonly path?: unknown }).path
          : null
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
  } catch {
    return null
  }
}

export interface ResolvedBinary {
  readonly path: string | null
  /** Why there is no path, for the single boot log line. */
  readonly reason: string | null
}

export const resolveBinary = (
  /** The executable to look for: `ffmpeg` or `ffprobe` in production. */
  name: string,
  packageName: string,
  configured: string | undefined,
  search: ExecutableSearch,
): ResolvedBinary => {
  if (configured !== undefined && configured !== '') {
    const candidate = isAbsolute(configured) ? configured : resolve(configured)
    if (isExecutable(candidate)) return { path: candidate, reason: null }
    // Configured and wrong is a misconfiguration, not a reason to look elsewhere: an
    // operator who set this wants that build, and quietly using another one is how a
    // deployment ends up encoding with something nobody chose.
    return { path: null, reason: `${name} is configured as ${configured}, which is not executable` }
  }

  const bundled = fromStaticPackage(packageName)
  if (bundled !== null && isExecutable(bundled)) return { path: bundled, reason: null }

  const found = onPath(name, search)
  if (found !== null) return { path: found, reason: null }

  return { path: null, reason: `${name} was not found on PATH and no ${packageName} is installed` }
}

export type FfmpegCapability =
  | { readonly available: true; readonly paths: FfmpegPaths }
  | { readonly available: false; readonly reason: string }

/** Short: this runs during boot, before the port opens. */
const CAPABILITY_TIMEOUT_MS = 10_000

/**
 * Whether this box can encode what a browser will play.
 *
 * The check is `-encoders`, and what it looks for is `libx264` and `aac` **by name**.
 * Deliberately never a version string: distributions carry patched builds with their own
 * version numbers, `n7.1-static` and `7.1.1-1ubuntu2` are both fine, and a build compiled
 * without the non-free encoders reports a perfectly modern version right up until the
 * first transcode fails. The question is not how new ffmpeg is, it is what it can do.
 */
export const probeFfmpegCapability = async (
  overrides: BinaryOverrides,
): Promise<FfmpegCapability> => {
  const ffmpeg = resolveBinary('ffmpeg', 'ffmpeg-static', overrides.ffmpegPath, overrides.search)
  if (ffmpeg.path === null) {
    return { available: false, reason: ffmpeg.reason ?? 'ffmpeg was not found' }
  }

  const ffprobe = resolveBinary(
    'ffprobe',
    'ffprobe-static',
    overrides.ffprobePath,
    overrides.search,
  )
  if (ffprobe.path === null) {
    return { available: false, reason: ffprobe.reason ?? 'ffprobe was not found' }
  }

  const encoders = await runProcess({
    binary: ffmpeg.path,
    args: ['-hide_banner', '-loglevel', 'error', '-nostdin', '-encoders'],
    timeoutMs: CAPABILITY_TIMEOUT_MS,
    stallMs: CAPABILITY_TIMEOUT_MS,
    // The listing is some thirty kilobytes of stdout, which is output rather than a
    // diagnostic: the default budget already covers it several times over, and this
    // says so rather than relying on a default nobody would connect to this call.
    stdoutBytes: 512 * 1024,
  })

  if (!encoders.ok) {
    return {
      available: false,
      reason: `${ffmpeg.path} could not list its encoders (${encoders.failure ?? 'unknown'})`,
    }
  }

  const listing = encoders.stdout
  const missing = (['libx264', 'aac'] as const).filter((encoder) => !listing.includes(encoder))
  if (missing.length > 0) {
    return {
      available: false,
      reason: `${ffmpeg.path} has no ${missing.join(' and no ')} encoder, so it cannot produce a file a browser will play`,
    }
  }

  return { available: true, paths: { ffmpeg: ffmpeg.path, ffprobe: ffprobe.path } }
}
