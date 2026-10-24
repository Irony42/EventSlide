import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { minimalChildEnv } from '../src/infrastructure/media/runProcess'
import { loadConfig } from '../src/infrastructure/config/env'
import {
  HOST_VARIABLES,
  hostEnvironment,
  serverEnvironment,
  type ServerEnvironmentOptions,
} from '../tests/e2e/fixtures/childEnvironment'

/**
 * The end-to-end server's environment is built from nothing, not from the shell
 * (tests/e2e/fixtures/childEnvironment.ts).
 *
 * `startTestApp` used to spread `process.env` over a hand-picked list of overrides. Every
 * configuration variable it did not list was still taken from the developer's shell or the CI
 * runner, so one exported `SITE_ADMIN` or `NEW_CLIENT_MAX_EVENTS` turned the "stock server" specs
 * into specs of a configured one, or refused the boot, on one machine and nowhere else. This asks
 * the builder what a polluted shell does to the server, without a browser or a port.
 */

const OPTIONS: Omit<ServerEnvironmentOptions, 'host'> = {
  worker: 3,
  port: 41_234,
  baseUrl: 'http://127.0.0.1:41234',
  databasePath: '/tmp/e2e/eventslide.sqlite',
  mediaRoot: '/tmp/e2e/media',
  eventCreation: 'anyAccount',
  owner: { email: 'owner@example.test', password: 'correct horse battery staple' },
}

/** What a shell that has been configured for something else looks like. */
const POLLUTED_SHELL: Record<string, string> = {
  SITE_ADMIN: 'on',
  NEW_CLIENT_MAX_EVENTS: '3',
  NEW_CLIENT_CLIPS_ALLOWED: 'off',
  MFA_ENCRYPTION_KEY: 'a'.repeat(44),
  REQUIRE_OPERATOR_2FA: 'on',
  SOURCE_REF: 'main',
  SOURCE_CODE_URL: 'https://example.test/source',
  EVENT_SLUG_SUFFIX: 'random',
  ALLOW_CUSTOM_SLUGS: 'false',
  JOIN_CODE_LENGTH: '8',
  TRUST_PROXY_HOPS: '2',
  MIN_FREE_DISK_BYTES: '999999999999',
  MAX_UPLOAD_BYTES: '1',
  AUDIT_RETENTION_DAYS: '400',
  OPERATOR_RESET_LINKS: 'off',
  EVENT_CREATION: 'clientMembers',
  SMTP_URL: 'smtp://relay.example.test:25',
  MAIL_FROM: 'noreply@example.test',
  SUPPORT_URL: 'https://example.test/support',
  PUBLIC_URL: 'https://photos.example.test',
  NODE_ENV: 'production',
  SESSION_SECRET: 'x'.repeat(40),
  GITHUB_TOKEN: 'a token that must never reach the child',
}

const MACHINE: Record<string, string> = {
  PATH: '/usr/bin:/bin',
  PATHEXT: '.EXE;.CMD',
  SYSTEMROOT: 'C:\\Windows',
  WINDIR: 'C:\\Windows',
  TEMP: '/tmp',
  TMP: '/tmp',
  HOME: '/home/ci',
  USERPROFILE: 'C:\\Users\\ci',
}

describe('the environment of the end-to-end server', () => {
  it('takes no configuration variable from the shell, however many it exports', () => {
    const env = serverEnvironment({ ...OPTIONS, host: { ...POLLUTED_SHELL, ...MACHINE } })

    for (const name of Object.keys(POLLUTED_SHELL)) {
      if (['NODE_ENV', 'PUBLIC_URL', 'SESSION_SECRET', 'EVENT_CREATION'].includes(name)) continue
      expect(env, name).not.toHaveProperty(name)
    }
    expect(env['GITHUB_TOKEN']).toBeUndefined()
  })

  it('states the variables a spec depends on, over whatever the shell says', () => {
    const env = serverEnvironment({ ...OPTIONS, host: { ...POLLUTED_SHELL, ...MACHINE } })

    expect(env['NODE_ENV']).toBe('test')
    expect(env['PUBLIC_URL']).toBe('http://127.0.0.1:41234')
    expect(env['PORT']).toBe('41234')
    expect(env['SESSION_SECRET']).toContain('worker-3')
    expect(env['EVENT_CREATION']).toBe('anyAccount')
    expect(env['E2E_HOOKS']).toBe('1')
  })

  it('passes the facts about the machine, and only those', () => {
    const env = serverEnvironment({ ...OPTIONS, host: { ...POLLUTED_SHELL, ...MACHINE } })

    for (const [name, value] of Object.entries(MACHINE)) expect(env[name], name).toBe(value)
    expect([...HOST_VARIABLES].sort()).toEqual(Object.keys(MACHINE).sort())
  })

  it('has exactly the host variables and the stated ones, so a spread of the shell shows', () => {
    const clean = serverEnvironment({ ...OPTIONS, host: MACHINE })
    const polluted = serverEnvironment({ ...OPTIONS, host: { ...POLLUTED_SHELL, ...MACHINE } })

    expect(Object.keys(polluted).sort()).toEqual(Object.keys(clean).sort())
    expect(polluted).toEqual(clean)
  })

  it('boots to the same configuration whatever the shell holds', () => {
    // The point of the whole module: the server the specs talk to is not a function of the
    // machine they run on. A boot that refused (NEW_CLIENT_MAX_EVENTS with SITE_ADMIN off) would
    // throw here before it failed a spec.
    const clean = loadConfig(serverEnvironment({ ...OPTIONS, host: MACHINE }))
    const polluted = loadConfig(
      serverEnvironment({ ...OPTIONS, host: { ...POLLUTED_SHELL, ...MACHINE } }),
    )

    expect(polluted).toEqual(clean)
    expect(clean.mail.smtp).toBeNull()
  })

  it('turns SITE_ADMIN on for client members only, which the boot requires of the pair', () => {
    const anyAccount = serverEnvironment({ ...OPTIONS, host: { SITE_ADMIN: 'on', ...MACHINE } })
    const clientMembers = serverEnvironment({
      ...OPTIONS,
      eventCreation: 'clientMembers',
      host: MACHINE,
    })

    expect(anyAccount).not.toHaveProperty('SITE_ADMIN')
    expect(clientMembers['SITE_ADMIN']).toBe('on')
    expect(clientMembers['EVENT_CREATION']).toBe('clientMembers')
    expect(() => loadConfig(clientMembers)).not.toThrow()
  })

  it('lets a spec override anything, last', () => {
    const env = serverEnvironment({
      ...OPTIONS,
      host: MACHINE,
      overrides: { SUPPORT_URL: 'https://example.test/help', UPLOAD_RATE_LIMIT_PER_MINUTE: '2' },
    })

    expect(env['SUPPORT_URL']).toBe('https://example.test/help')
    expect(env['UPLOAD_RATE_LIMIT_PER_MINUTE']).toBe('2')
  })
})

describe('hostEnvironment', () => {
  it('reads the names it is told to, and skips one the machine does not have', () => {
    expect(hostEnvironment({ PATH: '/bin', HOME: undefined, SITE_ADMIN: 'on' })).toStrictEqual({
      PATH: '/bin',
    })
  })
})

describe('what the builder is given, and what it ignores', () => {
  it('reads the environment it is handed and never the real one', () => {
    // A builder that spread `process.env` would pass every case above, because the names of the
    // polluted shell are not in the real environment of this process. Here they are.
    vi.stubEnv('SITE_ADMIN', 'on')
    vi.stubEnv('NEW_CLIENT_MAX_EVENTS', '3')
    try {
      const env = serverEnvironment({ ...OPTIONS, host: MACHINE })

      expect(env).not.toHaveProperty('SITE_ADMIN')
      expect(env).not.toHaveProperty('NEW_CLIENT_MAX_EVENTS')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('keeps every variable the server forwards to its encoder among the host variables', () => {
    // The server hands ffmpeg PATH and, on Windows, a few system variables it reads from its
    // own environment (`minimalChildEnv`). If one is added there and not here, the e2e server
    // is the one place it silently does not reach.
    const forwarded = Object.keys(
      minimalChildEnv(
        { path: 'p', pathExt: 'e', systemRoot: 's', winDir: 'w', temp: 't', tmp: 'm' },
        'win32',
      ),
    ).filter((name) => name !== 'LANG')

    expect(
      forwarded.filter((name) => !(HOST_VARIABLES as readonly string[]).includes(name)),
    ).toEqual([])
  })
})

describe('the end-to-end suite', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
  const sources = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) return entry.name === '__screenshots__' ? [] : sources(path)
      return /.ts$/.test(entry.name) ? [path] : []
    })

  it('boots the server through serverEnvironment', () => {
    const startTestApp = readFileSync(
      join(ROOT, 'tests', 'e2e', 'fixtures', 'startTestApp.ts'),
      'utf8',
    )

    expect(startTestApp).toContain('serverEnvironment({')
  })

  it('spreads the real environment into no child process', () => {
    // `...process.env` in a spawn is how one exported variable reached the server under test.
    // The few specs that start their own processes take `hostEnvironment(process.env)`.
    const offenders = sources(join(ROOT, 'tests', 'e2e'))
      .filter((path) => readFileSync(path, 'utf8').includes('...process.env'))
      .map((path) => path.slice(ROOT.length + 1))

    expect(offenders).toEqual([])
  })
})
