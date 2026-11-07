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

/** Run as a program, and not when a test imports `selectSpecs`. */
const entry = process.argv[1]
if (entry !== undefined && /changedSpecs\.ts$/.test(entry.replaceAll('\\', '/'))) {
  const flag = process.argv.indexOf('--project')
  const project = flag < 0 ? undefined : process.argv[flag + 1]
  if (project === undefined) {
    console.error('Usage: node scripts/changedSpecs.ts --project <name>  (file names on stdin)')
    process.exitCode = 2
  } else {
    const files = readFileSync(0, 'utf8').split(/\r?\n/).filter(Boolean)
    for (const spec of selectSpecs(files, project)) console.log(spec)
  }
}
