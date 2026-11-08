/**
 * `npm run flake-rate -- <report.json>...` — how often each end-to-end test passed, passed only
 * on a retry, or failed, read from the Playwright JSON reports CI uploads.
 *
 * CI keeps `retries: 2` and `failOnFlaky` turns a pass-on-retry into a failed run, which says
 * *that* a test flaked but not how often. A report only ever describes one run (one shard, one
 * project). This tool adds up as many as it is given, so the same command answers both "what
 * flaked in this run" (the step summary of every shard) and "what has flaked over the last
 * fifty runs" (download the `playwright-json-*` artifacts with `gh run download`, pass them all).
 *
 * A test is one (project, file, describe titles, title). Every `--repeat-each` repetition and
 * every report contributes one outcome to it: `expected` is passed, `flaky` is passed after a
 * retry, `unexpected` is failed; `skipped` says nothing about stability and is left out. The
 * rate is `(flaky + failed) / (passed + flaky + failed)`.
 *
 * `run(argv)` returns an exit code, the way `purge.ts` does, so a test can drive it.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'

export interface FlakeRow {
  readonly key: string
  readonly passed: number
  readonly flaky: number
  readonly failed: number
  readonly rate: number
}

interface Tally {
  passed: number
  flaky: number
  failed: number
}

interface JsonTest {
  readonly projectName: string
  readonly status: string
}

interface JsonSpec {
  readonly title: string
  readonly file: string
  readonly tests: readonly JsonTest[]
}

interface JsonSuite {
  readonly title: string
  readonly specs: readonly JsonSpec[]
  readonly suites?: readonly JsonSuite[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const notAReport = (): Error => new Error('not a Playwright JSON report (no `suites` array)')

/** Every spec under `suite`, with the describe titles above it (the file suite excluded). */
function* specsOf(
  suite: JsonSuite,
  describes: readonly string[],
): Generator<{ spec: JsonSpec; path: readonly string[] }> {
  for (const spec of suite.specs) yield { spec, path: describes }
  for (const child of suite.suites ?? []) yield* specsOf(child, [...describes, child.title])
}

function tally(reports: readonly unknown[]): Map<string, Tally> {
  const tallies = new Map<string, Tally>()
  for (const report of reports) {
    if (!isRecord(report) || !Array.isArray(report['suites'])) throw notAReport()
    for (const fileSuite of report['suites'] as readonly JsonSuite[]) {
      for (const { spec, path } of specsOf(fileSuite, [])) {
        for (const test of spec.tests) {
          const counts =
            test.status === 'expected'
              ? 'passed'
              : test.status === 'flaky'
                ? 'flaky'
                : test.status === 'unexpected'
                  ? 'failed'
                  : undefined
          if (counts === undefined) continue
          const key = [test.projectName, spec.file, ...path, spec.title].join(' › ')
          const entry = tallies.get(key) ?? { passed: 0, flaky: 0, failed: 0 }
          entry[counts] += 1
          tallies.set(key, entry)
        }
      }
    }
  }
  return tallies
}

/** One row per test, flakiest first; ties go to the test with more bad runs, then by name. */
export function summarise(reports: readonly unknown[]): FlakeRow[] {
  const rows = [...tally(reports)].map(([key, { passed, flaky, failed }]) => ({
    key,
    passed,
    flaky,
    failed,
    rate: (flaky + failed) / (passed + flaky + failed),
  }))
  return rows.sort(
    (a, b) =>
      b.rate - a.rate ||
      b.flaky + b.failed - (a.flaky + a.failed) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  )
}

interface RenderOptions {
  readonly all: boolean
}

const percent = (rate: number): string => `${Math.round(rate * 1000) / 10}%`
const notClean = (row: FlakeRow): boolean => row.flaky + row.failed > 0

function shown(rows: readonly FlakeRow[], { all }: RenderOptions): FlakeRow[] {
  return all ? [...rows] : rows.filter(notClean)
}

const headline = (rows: readonly FlakeRow[]): string =>
  `${rows.length} tests, ${rows.filter(notClean).length} not clean`

export function renderText(rows: readonly FlakeRow[], options: RenderOptions): string {
  const listed = shown(rows, options)
  if (listed.length === 0) return `No flaky or failed test (${headline(rows)}).`
  const lines = listed.map(
    (row) =>
      `${String(row.passed).padStart(4)} passed ${String(row.flaky).padStart(3)} flaky ` +
      `${String(row.failed).padStart(3)} failed ${percent(row.rate).padStart(6)}  ${row.key}`,
  )
  return `${headline(rows)}\n${lines.join('\n')}`
}

export function renderMarkdown(rows: readonly FlakeRow[], options: RenderOptions): string {
  const listed = shown(rows, options)
  if (listed.length === 0) {
    return `### Flake rate per test\n\nNo flaky or failed test (${headline(rows)}).\n`
  }
  const lines = listed.map(
    (row) =>
      `| ${row.passed} | ${row.flaky} | ${row.failed} | ${percent(row.rate)} | \`${row.key}\` |`,
  )
  return [
    '### Flake rate per test',
    '',
    `${headline(rows)}.`,
    '',
    '| passed | flaky | failed | rate | test |',
    '| ---: | ---: | ---: | ---: | --- |',
    ...lines,
    '',
  ].join('\n')
}

export const run = (argv: readonly string[]): number => {
  const all = argv.includes('--all')
  // `--summary <file>`: where to append the Markdown table (CI passes "$GITHUB_STEP_SUMMARY").
  // A flag rather than a read of the environment: `process.env` is the config module's alone.
  const flag = argv.indexOf('--summary')
  const summaryFile = flag < 0 ? undefined : argv[flag + 1]
  const paths = argv.filter((arg, index) => {
    if (arg === '--all' || arg === '--summary') return false
    return !(flag >= 0 && index === flag + 1)
  })
  if (paths.length === 0 || (flag >= 0 && summaryFile === undefined)) {
    console.error('Usage: flake-rate [--all] [--summary <file>] <playwright-report.json>...')
    return 2
  }

  const reports: unknown[] = []
  for (const path of paths) {
    // A shard that died before writing its report must not turn the reporting step red on top
    // of the failure that already is; a file that exists and does not parse is a different
    // matter, because a truncated upload read as "all clean" would be a wrong answer.
    if (!existsSync(path)) {
      console.error(`flake-rate: ${path} does not exist, skipped`)
      continue
    }
    try {
      reports.push(JSON.parse(readFileSync(path, 'utf8')) as unknown)
      summarise([reports[reports.length - 1]])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`flake-rate: ${path}: ${message}`)
      return 1
    }
  }

  if (reports.length === 0) {
    const note = 'No Playwright JSON report was found, so there is no flake rate to show.'
    console.log(note)
    if (summaryFile) appendFileSync(summaryFile, `### Flake rate per test\n\n${note}\n`)
    return 0
  }

  const rows = summarise(reports)
  console.log(renderText(rows, { all }))
  if (summaryFile) appendFileSync(summaryFile, renderMarkdown(rows, { all }))
  return 0
}

/** Run as a program, and not when a test imports `run` (see `purge.ts`). */
if (require.main === module) {
  process.exitCode = run(process.argv.slice(2))
}
