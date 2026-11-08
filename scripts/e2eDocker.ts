import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * `npm run test:e2e:docker -- <playwright arguments>`: the end-to-end suite in the container CI
 * uses, from a workstation. On Windows or macOS the browsers are not the Linux ones CI runs, and
 * "it passes here" says little about a flake that only shows on that stack.
 *
 * The image is `mcr.microsoft.com/playwright:v<version>-noble`, the version being the
 * `@playwright/test` one in package-lock.json: the browsers inside it are the exact revisions
 * that Playwright expects, and a drift between the two is an error at launch, not a surprise.
 * `.github/workflows/ci.yml` names the same image and `scripts/ciContainer.test.ts` holds the two.
 *
 * Three rules about the host, because this runs on a developer's machine and not on a disposable
 * runner:
 *
 * - The repository is mounted **read-only**. Its source is copied into the container's own
 *   filesystem, so a run builds `dist/`, writes `test-results/` and the SQLite files there and
 *   leaves the checkout alone.
 * - `node_modules` is **Linux, in a docker volume**. The host's tree holds Windows or macOS
 *   binaries (`better-sqlite3`, `sharp`, `esbuild`) that cannot run in the container, and the
 *   container's must never land in the host's. The volume is keyed by nothing but the lockfile
 *   hash and Node version: `npm ci` runs again only when package-lock.json or Node changed. It is mounted at `/deps`, not
 *   at `/work/node_modules`, because `npm ci` removes `node_modules` first and cannot remove a
 *   mount point (EBUSY); `/work/node_modules` is a link to it.
 * - What a run leaves worth reading (the HTML report, traces, the JSON report) is copied to
 *   `playwright-report-docker/` of the checkout, which is the one place written on the host.
 */

export const IMAGE_REPOSITORY = 'mcr.microsoft.com/playwright'
export const DEPS_VOLUME = 'eventslide-e2e-node-modules'
export const REPORT_DIRECTORY = 'playwright-report-docker'

/** `@playwright/test`'s version out of the text of a package-lock.json. */
export function playwrightVersion(lockfile: string): string {
  const parsed = JSON.parse(lockfile) as {
    packages?: Record<string, { version?: string } | undefined>
  }
  const version = parsed.packages?.['node_modules/@playwright/test']?.version
  if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('package-lock.json has no exact version of @playwright/test')
  }
  return version
}

export const imageFor = (version: string): string => `${IMAGE_REPOSITORY}:v${version}-noble`

/**
 * What runs inside the container. A fixed text with the Playwright arguments arriving as `"$@"`,
 * so nothing the caller types is ever interpreted by this shell.
 */
export const CONTAINER_SCRIPT = [
  'set -eu',
  'mkdir -p /work /deps /out',
  // Source in, without the host's build output and, above all, without its node_modules.
  'tar -C /src --exclude=./node_modules --exclude=./dist --exclude=./.git --exclude=./coverage --exclude=./test-results --exclude=./playwright-report --exclude=./playwright-json --exclude=./' +
    REPORT_DIRECTORY +
    ' -cf - . | tar -C /work -xf -',
  'cd /work',
  'stamp="$(node --version) $(sha256sum package-lock.json | cut -d" " -f1)"',
  'if [ "$(cat /deps/.lock-hash 2>/dev/null || true)" != "$stamp" ]; then',
  '  cp package.json package-lock.json /deps/',
  '  (cd /deps && (npm ci || npm ci))',
  '  echo "$stamp" > /deps/.lock-hash',
  'fi',
  'ln -sfn /deps/node_modules /work/node_modules',
  'npm run build',
  'status=0',
  'npm run test:e2e -- "$@" || status=$?',
  'cp -R playwright-report test-results playwright-json /out/ 2>/dev/null || true',
  'exit "$status"',
].join('\n')

/** The `docker` arguments for one run; `repository` is the absolute path of the checkout. */
export function dockerArguments(
  version: string,
  repository: string,
  playwrightArguments: readonly string[],
): string[] {
  return [
    'run',
    '--rm',
    // Chromium's shared memory, as the Playwright documentation asks of a container.
    '--ipc=host',
    // `/root` is where the Playwright image keeps what Firefox needs to start as root.
    '--env',
    'HOME=/root',
    // What `playwright.config.ts` switches on: retries, workers, failOnFlaky, the JSON report.
    '--env',
    'CI=1',
    '--volume',
    `${repository}:/src:ro`,
    '--volume',
    `${DEPS_VOLUME}:/deps`,
    '--volume',
    `${resolve(repository, REPORT_DIRECTORY)}:/out`,
    imageFor(version),
    'bash',
    '-c',
    CONTAINER_SCRIPT,
    'e2e-docker',
    ...playwrightArguments,
  ]
}

/** What `run` needs of a child process: `spawnSync`'s answer, as far as it reads it. */
export type Docker = (args: readonly string[]) => {
  readonly status: number | null
  readonly error?: Error | undefined
}

/**
 * The command: Playwright's own arguments, passed through. Returns the exit code and what to
 * print (as `[stream, line]`), with `docker` injected so a test can drive it without a process.
 */
export function run(
  argv: readonly string[],
  repository: string,
  docker: Docker,
): { readonly code: number; readonly lines: readonly (readonly ['log' | 'error', string])[] } {
  const version = playwrightVersion(readFileSync(resolve(repository, 'package-lock.json'), 'utf8'))
  const announce = `docker run ${imageFor(version)}  (node_modules in the volume ${DEPS_VOLUME})`
  const result = docker(dockerArguments(version, repository, argv))
  if (result.error !== undefined) {
    return {
      code: 127,
      lines: [
        ['log', announce],
        [
          'error',
          `Could not run docker: ${result.error.message}. Is Docker installed and running?`,
        ],
      ],
    }
  }
  return { code: result.status ?? 1, lines: [['log', announce]] }
}

/** Run as a program, and not when a test imports `run`. */
const entry = process.argv[1]
if (entry !== undefined && /e2eDocker\.ts$/.test(entry.replaceAll('\\', '/'))) {
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  // Made here, as the user: left to docker, a Linux host gets it created as root.
  mkdirSync(resolve(repository, REPORT_DIRECTORY), { recursive: true })
  const { code, lines } = run(process.argv.slice(2), repository, (args) =>
    spawnSync('docker', [...args], { stdio: 'inherit' }),
  )
  for (const [stream, line] of lines) console[stream](line)
  process.exitCode = code
}
