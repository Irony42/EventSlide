/**
 * Which changed end-to-end specs the pull-request repeat job runs on a project.
 *
 * `node scripts/changedSpecs.ts --project <name>` reads file names on stdin (the output of
 * `git diff --name-only`) and prints the specs to repeat, one per line, nothing when there are
 * none. It has no dependency on purpose: the job decides whether it has anything to do before
 * it pays for `npm ci` and a browser, and Node 24 runs this file as it is.
 *
 * The rules mirror `playwright.config.ts`: the offline specs belong to `chromium-offline` and
 * to no other project, the frame-rate specs to `perf` (repeated beside other browsers, or five
 * times over, a frame rate means nothing), and the `@visual` specs are compared by the visual
 * job against the merge base, not repeated.
 */
import { readFileSync } from 'node:fs'

const SPEC = /^tests\/e2e\/(?:.+\/)?[^/]+\.spec\.ts$/

export function selectSpecs(changed: readonly string[], project: string): string[] {
  const specs = changed.map((file) => file.replaceAll('\\', '/')).filter((file) => SPEC.test(file))
  const wanted = specs.filter((file) => {
    if (file.startsWith('tests/e2e/perf/') || file.startsWith('tests/e2e/visual/')) return false
    const offline = file.startsWith('tests/e2e/offline/')
    return project === 'chromium-offline' ? offline : !offline
  })
  return [...new Set(wanted)].sort()
}

/**
 * The command: `--project <name>` and the changed files (one per line) as `stdin`. Returns the
 * exit code and what to print, so a test can drive it without a process.
 */
export function run(
  argv: readonly string[],
  stdin: string,
): { readonly code: number; readonly lines: readonly string[] } {
  const flag = argv.indexOf('--project')
  const project = flag < 0 ? undefined : argv[flag + 1]
  if (project === undefined) {
    return {
      code: 2,
      lines: ['Usage: node scripts/changedSpecs.ts --project <name>  (file names on stdin)'],
    }
  }
  return { code: 0, lines: selectSpecs(stdin.split(/\r?\n/).filter(Boolean), project) }
}

/** Run as a program, and not when a test imports `run`. */
const entry = process.argv[1]
if (entry !== undefined && /changedSpecs\.ts$/.test(entry.replaceAll('\\', '/'))) {
  const { code, lines } = run(process.argv.slice(2), readFileSync(0, 'utf8'))
  for (const line of lines) (code === 0 ? console.log : console.error)(line)
  process.exitCode = code
}
