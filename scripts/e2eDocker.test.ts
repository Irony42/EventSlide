import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONTAINER_SCRIPT,
  DEPS_VOLUME,
  REPORT_DIRECTORY,
  dockerArguments,
  imageFor,
  playwrightVersion,
  run,
} from './e2eDocker'

/**
 * The local container run (`npm run test:e2e:docker`). Docker is not installed on every machine
 * that runs this suite, so what is pinned here is the command that would be run: the image, and
 * the three rules that keep the host's files safe (see the header of e2eDocker.ts).
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lockfile = readFileSync(join(ROOT, 'package-lock.json'), 'utf8')

describe('playwrightVersion', () => {
  it('reads the exact @playwright/test version of the lockfile', () => {
    const version = playwrightVersion(lockfile)
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(lockfile).toContain(`"node_modules/@playwright/test": {\n      "version": "${version}"`)
  })

  it('refuses a lockfile that has no such package, or no exact version', () => {
    expect(() => playwrightVersion('{"packages":{}}')).toThrow(/no exact version/)
    expect(() =>
      playwrightVersion('{"packages":{"node_modules/@playwright/test":{"version":"^1.65.0"}}}'),
    ).toThrow(/no exact version/)
  })
})

describe('dockerArguments', () => {
  const repository = '/home/pierre/EventSlide'
  const args = dockerArguments('1.65.0', repository, ['--project=webkit-mobile'])
  /** Every `--volume` value, in order. */
  const volumes = args.flatMap((arg, index) => (args[index - 1] === '--volume' ? [arg] : []))

  it('runs the noble image of that exact version, and throws the container away', () => {
    expect(imageFor('1.65.0')).toBe('mcr.microsoft.com/playwright:v1.65.0-noble')
    expect(args.slice(0, 2)).toEqual(['run', '--rm'])
    expect(args).toContain('mcr.microsoft.com/playwright:v1.65.0-noble')
    expect(args).toContain('--ipc=host')
  })

  it('mounts the checkout read-only, so a run cannot write into it', () => {
    expect(volumes).toContain(`${repository}:/src:ro`)
  })

  it('keeps the Linux node_modules in a docker volume, never a bind of the host tree', () => {
    expect(volumes).toContain(`${DEPS_VOLUME}:/deps`)
    expect(volumes.some((volume) => volume.includes('node_modules:'))).toBe(false)
  })

  it('writes to the host through one directory of the checkout and nowhere else', () => {
    const writable = volumes.filter((volume) => !volume.endsWith(':ro'))
    expect(writable).toEqual([
      `${DEPS_VOLUME}:/deps`,
      `${resolve(repository, REPORT_DIRECTORY)}:/out`,
    ])
  })

  it('hands the Playwright arguments over as positional parameters, not as shell text', () => {
    expect(args[args.indexOf('-c') + 1]).toBe(CONTAINER_SCRIPT)
    expect(args.slice(args.indexOf('-c') + 2)).toEqual(['e2e-docker', '--project=webkit-mobile'])
    expect(CONTAINER_SCRIPT).toContain('npm run test:e2e -- "$@"')
  })
})

describe('the script run in the container', () => {
  it('installs into the volume, only when the lockfile changed', () => {
    expect(CONTAINER_SCRIPT).toContain('/deps/.lock-hash')
    expect(CONTAINER_SCRIPT).toContain('(cd /deps && (npm ci || npm ci))')
    expect(CONTAINER_SCRIPT).toContain('ln -sfn /deps/node_modules /work/node_modules')
  })

  it('never copies the host node_modules or build output in', () => {
    for (const excluded of ['node_modules', 'dist', '.git', 'test-results']) {
      expect(CONTAINER_SCRIPT).toContain(`--exclude=./${excluded}`)
    }
  })

  it('keeps the exit status of the suite after copying the reports out', () => {
    expect(CONTAINER_SCRIPT).toMatch(/status=\$\?[\s\S]*cp -R[\s\S]*exit "\$status"/)
  })
})

describe('run', () => {
  const argv = ['--project=chromium-desktop']

  it('passes the arguments to docker with the image of the lockfile, and returns its exit status', () => {
    const seen: (readonly string[])[] = []
    const answer = run(argv, ROOT, (args) => {
      seen.push(args)
      return { status: 3 }
    })
    expect(answer.code).toBe(3)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain(imageFor(playwrightVersion(lockfile)))
    expect(seen[0]?.slice(-2)).toEqual(['e2e-docker', '--project=chromium-desktop'])
    expect(answer.lines).toEqual([
      ['log', expect.stringContaining(imageFor(playwrightVersion(lockfile)))],
    ])
  })

  it('is a failure when docker was killed by a signal and has no status', () => {
    expect(run(argv, ROOT, () => ({ status: null })).code).toBe(1)
  })

  it('says docker could not be run, and exits 127, when it is not installed', () => {
    const answer = run(argv, ROOT, () => ({
      status: null,
      error: new Error('spawnSync docker ENOENT'),
    }))
    expect(answer.code).toBe(127)
    expect(answer.lines.map(([stream]) => stream)).toEqual(['log', 'error'])
    expect(answer.lines[1]?.[1]).toContain('spawnSync docker ENOENT')
  })
})

describe('as a program', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it('runs docker on the arguments after the script name, and sets its exit code', async () => {
    const spawned: { command: unknown; args: unknown }[] = []
    // Never the machine's own docker: a test run must not start a container.
    vi.doMock('node:child_process', () => ({
      spawnSync: (command: unknown, args: unknown) => {
        spawned.push({ command, args })
        return { status: 5 }
      },
    }))
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(process, 'argv', 'get').mockReturnValue([
      'node',
      '/repo/scripts/e2eDocker.ts',
      '--list',
    ])
    vi.resetModules()
    await import('./e2eDocker')
    vi.doUnmock('node:child_process')
    expect(process.exitCode).toBe(5)
    expect(spawned).toHaveLength(1)
    expect(spawned[0]?.command).toBe('docker')
    expect(spawned[0]?.args).toContain('--list')
  })

  it('prints what docker said went wrong, and exits 127, when it cannot be started', async () => {
    vi.doMock('node:child_process', () => ({
      spawnSync: () => ({ status: null, error: new Error('spawnSync docker ENOENT') }),
    }))
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', '/repo/scripts/e2eDocker.ts'])
    vi.resetModules()
    await import('./e2eDocker')
    vi.doUnmock('node:child_process')
    expect(process.exitCode).toBe(127)
    expect(log).toHaveBeenCalledTimes(1)
    expect(error.mock.calls.flat().join(' ')).toContain('ENOENT')
  })

  it('does nothing when it is only imported by something else', async () => {
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', '/repo/node_modules/vitest/cli.js'])
    vi.resetModules()
    await import('./e2eDocker')
    expect(process.exitCode).toBeUndefined()
  })
})
