import type { Express } from 'express'
import { get, createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPinoLogger } from '../../../infrastructure/logging/pinoLogger'
import { captureAllOutputWhile } from './captureOutput'
import { buildServerHarness } from './serverHarness'

/**
 * A credential address spelled another way must write no credential into any log.
 *
 * `loggablePath` is what writes a link's token as `:token` on every line a request's logger
 * produces. It used to match a pattern anchored on the raw path, so a path that Express and
 * the client would call the same address, spelled differently, stepped round it: `/%67/<token>`
 * is `/g/<token>` to a decoder, and a proxy or a client library may well send it that way. The
 * line that carries the path at debug level is the handler's own "request rejected", and a
 * link with a broken escape after the token is the way to make a real, enabled logger write
 * one: the client fallback decodes its wildcard and answers `400`.
 *
 * Like `malformedPathLogCanary.test.ts`, this reads every byte the real app logger and a real,
 * enabled access log write; what each spelling is logged as is `errorHandler.test.ts`.
 */

const TOKEN = 'canary-token-8c2e5a1f7d3b9604'
const BROKEN = '%E0%A4%A'
const INSTANCE = { service: 'eventslide', version: 'path-canary', instance: 'path-canary-box' }

/**
 * Every address whose last segment is a credential, and how a log line must write it.
 * `page` is whether it is a wildcard page route (`/g/*splat`), which takes a `.` segment in
 * front of the token to its handler; the API routers have no route for that and answer 404.
 */
const FAMILIES: readonly {
  readonly address: string
  readonly logged: string
  readonly page: boolean
}[] = [
  { address: '/g', logged: '/g/:token', page: true },
  { address: '/api/gallery', logged: '/api/gallery/:token', page: false },
  { address: '/password/reset', logged: '/password/reset/:token', page: true },
  { address: '/invite', logged: '/invite/:token', page: true },
  { address: '/api/invitations', logged: '/api/invitations/:token', page: false },
]

/** `g` as `%67`, in the case the escape is written in. */
const escapeLetters = (text: string, hex: 'lower' | 'upper'): string =>
  [...text]
    .map((char) => {
      if (!/[a-z]/.test(char)) return char
      const code = char.charCodeAt(0).toString(16)
      return `%${hex === 'lower' ? code : code.toUpperCase()}`
    })
    .join('')

/** The same address, spelled the ways one address can be spelled. */
const SPELLINGS: readonly {
  readonly label: string
  readonly spell: (address: string) => string
  /** The dot segment sits between the address and the token, so an API router has no route. */
  readonly dotBeforeToken?: true
}[] = [
  { label: 'doubled slashes', spell: (address) => address.replace(/\//g, '//') },
  {
    label: 'its first letter escaped',
    spell: (address) =>
      address.replace(/^\/([a-z])/, (_whole, letter: string) => {
        return `/${escapeLetters(letter, 'lower')}`
      }),
  },
  { label: 'every letter escaped, in lower case', spell: (a) => escapeLetters(a, 'lower') },
  { label: 'every letter escaped, in upper case', spell: (a) => escapeLetters(a, 'upper') },
  {
    label: 'doubled slashes and escaped letters together',
    spell: (address) => escapeLetters(address, 'lower').replace(/\//g, '//'),
  },
  // The page routes are wildcards, so `/g/./<token>` reaches the page with `.` as its first
  // segment, and a client that does not resolve dot segments (`curl --path-as-is`) can send it.
  {
    label: 'a dot segment before the token',
    spell: (address) => `${address}/.`,
    dotBeforeToken: true,
  },
  { label: 'a dot segment escaped', spell: (address) => `${address}/%2e`, dotBeforeToken: true },
  { label: 'a parent segment in front of it', spell: (address) => `/x/..${address}` },
]

const SPELLED_PATHS = FAMILIES.flatMap(({ address, logged, page }) =>
  SPELLINGS.map(({ label, spell, dotBeforeToken }) => ({
    label: `${address} with ${label}`,
    path: `${spell(address)}/${TOKEN}${BROKEN}`,
    logged,
    // The handler writes the line that carries the path when the router cannot decode the
    // path, so an address the API answers with a plain 404 writes none, and a "no token in the
    // log" assertion over it is true but says little. It is kept; the line check skips it.
    writesLine: page || dotBeforeToken !== true,
  })),
)

const LINE_WRITING_PATHS = SPELLED_PATHS.filter(({ writesLine }) => writesLine)

/**
 * One request over a real socket, with the path exactly as written.
 *
 * Not supertest: an HTTP client built on the WHATWG URL parser resolves `.` and `..` before it
 * sends anything, so a dot segment would never reach the server and a test of one would only
 * prove the client's tidiness.
 */
const getRaw = (app: Express, path: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const server = createServer(app)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('the canary server has no port'))
        return
      }
      get({ host: '127.0.0.1', port: address.port, path }, (response) => {
        response.resume()
        response.on('end', () => server.close(() => resolve()))
      }).on('error', (error) => server.close(() => reject(error)))
    })
  })

describe('a credential address spelled another way', () => {
  let clientDir: string

  beforeAll(async () => {
    clientDir = await mkdtemp(join(tmpdir(), 'eventslide-loggable-path-canary-'))
    await writeFile(join(clientDir, 'index.html'), '<!doctype html>', 'utf8')
  })

  afterAll(async () => {
    await rm(clientDir, { recursive: true, force: true })
  })

  const write = async (paths: readonly string[]): Promise<string> => {
    const logger = createPinoLogger({ level: 'trace', pretty: false, bindings: INSTANCE })
    const harness = buildServerHarness({
      clientDir,
      logger,
      config: { accessLog: { enabled: true, level: 'trace', pretty: false, ...INSTANCE } },
    })
    return captureAllOutputWhile(async () => {
      for (const path of paths) await getRaw(harness.app, path)
    })
  }

  it.each(SPELLED_PATHS)('writes no token into any log for $label', async ({ path }) => {
    const output = await write([path])

    expect(output).not.toContain(TOKEN)
  })

  it.each(LINE_WRITING_PATHS)(
    'does write the line, with the path as :token, for $label',
    async ({ path, logged }) => {
      const output = await write([path])

      // Not "nothing was captured": the handler's own line is there, under the canonical
      // spelling, and it is the only line that carries the path.
      expect(output).toContain(INSTANCE.instance)
      expect(output).toContain('request rejected')
      expect(output).toContain(`"path":"${logged}"`)
    },
  )
})
