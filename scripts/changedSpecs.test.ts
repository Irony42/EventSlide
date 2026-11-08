import { afterEach, describe, expect, it, vi } from 'vitest'
import { run, selectSpecs } from './changedSpecs'

/**
 * Which of the files a pull request touched the repeat job runs five times on a project.
 * The job exists to catch a new or changed journey that fails one run in five, so what it must
 * not do is pick a spec the project does not select (Playwright errors on "no tests found") or
 * repeat one that measures a frame rate beside the other browsers.
 */

const JOURNEY = 'tests/e2e/journeys/guest-upload.spec.ts'
const SECURITY = 'tests/e2e/security/tenant-isolation.spec.ts'
const OFFLINE = 'tests/e2e/offline/upload-queue.spec.ts'
const PERF = 'tests/e2e/perf/frame-budget.spec.ts'
const VISUAL = 'tests/e2e/visual/wall.spec.ts'

describe('selectSpecs', () => {
  it('keeps changed journey and security specs for a journey project', () => {
    expect(selectSpecs([SECURITY, JOURNEY], 'webkit-mobile')).toEqual([JOURNEY, SECURITY])
  })

  it('ignores everything that is not an end-to-end spec', () => {
    expect(
      selectSpecs(
        [
          'src/domain/events/event.test.ts',
          'tests/e2e/fixtures/app.ts',
          'tests/e2e/journeys/helpers.ts',
          'docs/TESTING.md',
          JOURNEY,
        ],
        'chromium-desktop',
      ),
    ).toEqual([JOURNEY])
  })

  it('leaves the offline specs to the offline project, which is the only one that selects them', () => {
    expect(selectSpecs([OFFLINE, JOURNEY], 'chromium-desktop')).toEqual([JOURNEY])
    expect(selectSpecs([OFFLINE, JOURNEY], 'chromium-offline')).toEqual([OFFLINE])
  })

  it('never repeats a frame-rate spec: the perf project runs it alone, once', () => {
    expect(selectSpecs([PERF], 'chromium-desktop')).toEqual([])
    expect(selectSpecs([PERF], 'chromium-offline')).toEqual([])
  })

  it('leaves the visual specs to the visual job, which compares against the merge base', () => {
    expect(selectSpecs([VISUAL], 'chromium-desktop')).toEqual([])
  })

  it('reads Windows separators and lists each spec once, sorted', () => {
    expect(
      selectSpecs(
        ['tests\\e2e\\journeys\\guest-upload.spec.ts', JOURNEY, SECURITY],
        'webkit-mobile',
      ),
    ).toEqual([JOURNEY, SECURITY])
  })

  it('selects nothing when nothing relevant changed', () => {
    expect(selectSpecs([], 'chromium-desktop')).toEqual([])
    expect(selectSpecs(['README.md'], 'webkit-mobile')).toEqual([])
  })
})

describe('run', () => {
  it('prints the specs of the project from the file names on stdin', () => {
    expect(run(['--project', 'webkit-mobile'], `${JOURNEY}\r\nREADME.md\n${OFFLINE}\n`)).toEqual({
      code: 0,
      lines: [JOURNEY],
    })
  })

  it('prints nothing, and succeeds, when there is no changed spec', () => {
    expect(run(['--project', 'chromium-desktop'], '')).toEqual({ code: 0, lines: [] })
  })

  it('asks for a project when it is given none', () => {
    expect(run([], JOURNEY).code).toBe(2)
    expect(run(['--project'], JOURNEY).code).toBe(2)
  })
})

describe('as a program', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.doUnmock('node:fs')
    process.exitCode = undefined
  })

  const start = async (argv: readonly string[], stdin: string): Promise<void> => {
    vi.doMock('node:fs', () => ({ readFileSync: () => stdin }))
    vi.spyOn(process, 'argv', 'get').mockReturnValue([
      'node',
      '/repo/scripts/changedSpecs.ts',
      ...argv,
    ])
    vi.resetModules()
    await import('./changedSpecs')
  }

  it('prints the specs, one per line', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await start(['--project', 'webkit-mobile'], `${JOURNEY}\n`)
    expect(log).toHaveBeenCalledWith(JOURNEY)
    expect(process.exitCode).toBe(0)
  })

  it('prints the usage on stderr and fails without a project', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await start([], '')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    expect(process.exitCode).toBe(2)
  })

  it('does nothing when it is only imported by something else', async () => {
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', '/repo/node_modules/vitest/cli.js'])
    vi.resetModules()
    await import('./changedSpecs')
    expect(process.exitCode).toBeUndefined()
  })
})
