import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Suite, TestCase } from '@playwright/test/reporter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FailOnFlaky, { flakyTests } from '../tests/e2e/reporters/failOnFlaky'

/**
 * The guard that turns "passed only on a retry" into a failed run (CI keeps `retries: 2`).
 *
 * Nothing else asserts it: a Playwright bump that renamed what `TestCase.outcome()` answers
 * would leave the reporter finding nothing, and every flaky test would go back to being
 * reported as a pass. These are fake suites with the outcomes Playwright documents.
 */

type Outcome = ReturnType<TestCase['outcome']>

const aTest = (title: string, outcome: Outcome): TestCase =>
  ({
    outcome: () => outcome,
    titlePath: () => ['', 'chromium-desktop', 'spec.ts', title],
    location: { file: '/repo/tests/e2e/spec.ts', line: 12, column: 1 },
  }) as unknown as TestCase

const aSuite = (...tests: TestCase[]): Suite => ({ allTests: () => tests }) as unknown as Suite

describe('flakyTests', () => {
  it('keeps only the tests that failed and then passed', () => {
    const flaky = aTest('flaky one', 'flaky')
    const suite = aSuite(
      aTest('passed', 'expected'),
      flaky,
      aTest('failed', 'unexpected'),
      aTest('skipped', 'skipped'),
    )

    expect(flakyTests(suite)).toEqual([flaky])
  })

  it('finds nothing before the run has begun', () => {
    expect(flakyTests(undefined)).toEqual([])
  })
})

describe('FailOnFlaky', () => {
  let directory: string
  let summary: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'fail-on-flaky-'))
    summary = join(directory, 'summary.md')
    vi.stubEnv('GITHUB_STEP_SUMMARY', summary)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    rmSync(directory, { recursive: true, force: true })
  })

  const run = async (...tests: TestCase[]) => {
    const reporter = new FailOnFlaky()
    reporter.onBegin(undefined, aSuite(...tests))
    return reporter.onEnd({ status: 'passed', startTime: new Date(0), duration: 0 })
  }

  it('fails the run and names the test in the job summary when one only passed on a retry', async () => {
    const verdict = await run(aTest('passed', 'expected'), aTest('wobbles', 'flaky'))

    expect(verdict).toEqual({ status: 'failed' })
    const written = readFileSync(summary, 'utf8')
    expect(written).toContain('Flaky tests (passed only on retry): 1')
    expect(written).toContain('chromium-desktop > spec.ts > wobbles (/repo/tests/e2e/spec.ts:12)')
  })

  it.each<Outcome>(['expected', 'unexpected', 'skipped'])(
    'leaves the verdict to Playwright when the only outcomes are %s',
    async (outcome) => {
      expect(await run(aTest('t', outcome))).toBeUndefined()
      expect(() => readFileSync(summary, 'utf8')).toThrow(/ENOENT/)
    },
  )
})
