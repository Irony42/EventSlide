import { appendFileSync } from 'node:fs'
import type { FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter'

/**
 * Fails the run when a test only passed on a retry.
 *
 * CI keeps `retries: 2` so that a browser losing a frame does not block a pull request, but a
 * retry also makes a flaky test invisible: Playwright reports it as "flaky" and exits 0. This
 * reporter turns that outcome into a failure, lists every such test in the job summary and in
 * the log, and leaves the verdict for tests that failed outright to Playwright itself.
 */
export default class FailOnFlaky implements Reporter {
  private root: Suite | undefined

  onBegin(_config: unknown, suite: Suite): void {
    this.root = suite
  }

  async onEnd(_result: FullResult): Promise<{ status: 'failed' } | undefined> {
    const flaky = flakyTests(this.root)
    if (flaky.length === 0) return undefined

    const lines = flaky.map(
      (test) =>
        `${test.titlePath().slice(1).join(' > ')} (${test.location.file}:${test.location.line})`,
    )
    console.error(
      `\n${flaky.length} flaky test(s): passed only on a retry, so the run fails.\n- ${lines.join('\n- ')}\n`,
    )

    const summary = process.env['GITHUB_STEP_SUMMARY']
    if (summary) {
      appendFileSync(
        summary,
        `### Flaky tests (passed only on retry): ${flaky.length}\n\n${lines.map((line) => `- \`${line}\``).join('\n')}\n`,
      )
    }
    return { status: 'failed' }
  }
}

/** Tests whose final outcome is "flaky": failed at least once, then passed. */
export const flakyTests = (root: Suite | undefined): TestCase[] =>
  root ? root.allTests().filter((test) => test.outcome() === 'flaky') : []
