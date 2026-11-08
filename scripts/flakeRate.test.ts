import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderMarkdown, renderText, run, summarise } from './flakeRate'

/**
 * `flakeRate` reads the Playwright JSON reports CI uploads and says, per test, how often it
 * passed, passed only on a retry, or failed. The fixtures are hand-built in the shape Playwright
 * 1.65 writes (checked against a real report): file suites holding describe suites holding specs
 * holding one `tests` entry per project and per `--repeat-each` repetition.
 */

type Status = 'expected' | 'unexpected' | 'flaky' | 'skipped'

const aTest = (projectName: string, status: Status) => ({ projectName, status, results: [] })

const aSpec = (title: string, ...tests: ReturnType<typeof aTest>[]) => ({
  title,
  file: 'journeys/a.spec.ts',
  tests,
})

const aReport = (...specs: ReturnType<typeof aSpec>[]) => ({
  suites: [
    {
      title: 'journeys/a.spec.ts',
      file: 'journeys/a.spec.ts',
      specs: [],
      suites: [{ title: 'a journey', file: 'journeys/a.spec.ts', specs, suites: [] }],
    },
  ],
})

describe('summarise', () => {
  it('counts passed, flaky and failed per test and project', () => {
    const rows = summarise([
      aReport(
        aSpec('uploads', aTest('chromium-desktop', 'expected'), aTest('webkit-mobile', 'flaky')),
        aSpec('moderates', aTest('chromium-desktop', 'unexpected')),
      ),
    ])

    expect(rows).toContainEqual({
      key: 'webkit-mobile › journeys/a.spec.ts › a journey › uploads',
      passed: 0,
      flaky: 1,
      failed: 0,
      rate: 1,
    })
    expect(rows).toContainEqual({
      key: 'chromium-desktop › journeys/a.spec.ts › a journey › uploads',
      passed: 1,
      flaky: 0,
      failed: 0,
      rate: 0,
    })
    expect(rows).toContainEqual({
      key: 'chromium-desktop › journeys/a.spec.ts › a journey › moderates',
      passed: 0,
      flaky: 0,
      failed: 1,
      rate: 1,
    })
  })

  it('adds up the repetitions of one test and the same test across reports', () => {
    const repeated = aReport(
      aSpec(
        'uploads',
        aTest('webkit-mobile', 'expected'),
        aTest('webkit-mobile', 'expected'),
        aTest('webkit-mobile', 'unexpected'),
        aTest('webkit-mobile', 'expected'),
      ),
    )
    const nextRun = aReport(aSpec('uploads', aTest('webkit-mobile', 'flaky')))

    const rows = summarise([repeated, nextRun])

    expect(rows).toEqual([
      {
        key: 'webkit-mobile › journeys/a.spec.ts › a journey › uploads',
        passed: 3,
        flaky: 1,
        failed: 1,
        rate: 0.4,
      },
    ])
  })

  it('leaves skipped tests out: they say nothing about stability', () => {
    expect(summarise([aReport(aSpec('later', aTest('chromium-desktop', 'skipped')))])).toEqual([])
  })

  it('sorts the flakiest first, then the one with more bad runs, then by name', () => {
    const rows = summarise([
      aReport(
        aSpec('stable', aTest('p', 'expected')),
        aSpec('b rare', aTest('p', 'expected'), aTest('p', 'expected'), aTest('p', 'flaky')),
        aSpec('a rare', aTest('p', 'expected'), aTest('p', 'expected'), aTest('p', 'flaky')),
        aSpec('often', aTest('p', 'flaky'), aTest('p', 'unexpected')),
        aSpec(
          'always',
          aTest('p', 'unexpected'),
          aTest('p', 'unexpected'),
          aTest('p', 'unexpected'),
        ),
      ),
    ]).map((row) => row.key.split(' › ').at(-1))

    // `always` and `often` are both at rate 1; the one with more bad runs leads.
    expect(rows).toEqual(['always', 'often', 'a rare', 'b rare', 'stable'])
  })

  it('names a test by its describe titles, not by the file suite that wraps them', () => {
    const report = {
      suites: [
        {
          title: 'a.spec.ts',
          file: 'a.spec.ts',
          specs: [aSpec('top level', aTest('p', 'expected'))],
          suites: [
            {
              title: 'outer',
              file: 'a.spec.ts',
              specs: [],
              suites: [
                {
                  title: 'inner',
                  file: 'a.spec.ts',
                  specs: [aSpec('deep', aTest('p', 'expected'))],
                  suites: [],
                },
              ],
            },
          ],
        },
      ],
    }

    expect(summarise([report]).map((row) => row.key)).toEqual([
      'p › journeys/a.spec.ts › outer › inner › deep',
      'p › journeys/a.spec.ts › top level',
    ])
  })

  it('refuses a document that is not a Playwright report', () => {
    expect(() => summarise([{ nothing: true }])).toThrow(/not a Playwright JSON report/)
    expect(() => summarise(['text'])).toThrow(/not a Playwright JSON report/)
  })
})

describe('renderText and renderMarkdown', () => {
  const rows = summarise([
    aReport(
      aSpec('steady', aTest('p', 'expected')),
      aSpec('shaky', aTest('p', 'expected'), aTest('p', 'flaky')),
    ),
  ])

  it('lists only the tests that were not clean, and counts the rest', () => {
    const text = renderText(rows, { all: false })

    expect(text).toContain('shaky')
    expect(text).not.toContain('steady')
    expect(text).toContain('2 tests, 1 not clean')
    expect(text).toContain('50%')
  })

  it('lists every test with `all`', () => {
    expect(renderText(rows, { all: true })).toContain('steady')
  })

  it('says so when nothing was flaky', () => {
    const clean = summarise([aReport(aSpec('clean', aTest('p', 'expected')))])
    expect(renderText(clean, { all: false })).toContain('No flaky or failed test')
    expect(renderMarkdown(clean, { all: false })).toContain('No flaky or failed test')
  })

  it('writes a markdown table with the counts and the rate', () => {
    const markdown = renderMarkdown(rows, { all: false })

    expect(markdown).toContain('### Flake rate per test')
    expect(markdown).toContain('| passed | flaky | failed | rate | test |')
    expect(markdown).toContain('| 1 | 1 | 0 | 50% | `p › journeys/a.spec.ts › a journey › shaky` |')
  })
})

describe('run', () => {
  let directory: string
  let summary: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'flake-rate-'))
    summary = join(directory, 'summary.md')
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(directory, { recursive: true, force: true })
  })

  const write = (name: string, content: unknown): string => {
    const path = join(directory, name)
    writeFileSync(path, JSON.stringify(content))
    return path
  }

  it('merges several reports, prints the table and appends it to the step summary', () => {
    const one = write('one.json', aReport(aSpec('uploads', aTest('p', 'flaky'))))
    const two = write('two.json', aReport(aSpec('uploads', aTest('p', 'expected'))))

    const code = run(['--summary', summary, one, two])

    expect(code).toBe(0)
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('uploads')
    expect(readFileSync(summary, 'utf8')).toContain('| 1 | 1 | 0 | 50% |')
  })

  it('notes a report that is missing and carries on with the others', () => {
    const one = write('one.json', aReport(aSpec('uploads', aTest('p', 'expected'))))

    const code = run([join(directory, 'absent.json'), one])

    expect(code).toBe(0)
    expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toContain('absent.json')
  })

  it('exits 0 and says why when it was given nothing to read', () => {
    expect(run(['--summary', summary, join(directory, 'absent.json')])).toBe(0)
    expect(readFileSync(summary, 'utf8')).toContain('No Playwright JSON report')
  })

  it('fails on a file that is not a report: a truncated upload must not read as all clean', () => {
    const broken = join(directory, 'broken.json')
    writeFileSync(broken, '{"suites": [')

    expect(run([broken])).toBe(1)
    expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toContain('broken.json')
  })

  it('asks for a file when it is given none', () => {
    expect(run([])).toBe(2)
    expect(run(['--summary'])).toBe(2)
    expect(run(['--summary', summary])).toBe(2)
  })

  it('shows every test with --all', () => {
    const one = write('one.json', aReport(aSpec('clean one', aTest('p', 'expected'))))

    run(['--all', one])

    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain('clean one')
  })
})
