import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPinoLogger } from '../../../infrastructure/logging/pinoLogger'
import { captureAllOutputWhile } from './captureOutput'
import { buildServerHarness } from './serverHarness'

/**
 * A link cut in the middle of a percent-escape must write no credential into any log.
 *
 * Express decodes a route parameter itself and, when it cannot, throws a `URIError` whose
 * message is `Failed to decode param '<the raw parameter>'`. On a gallery, invitation or
 * password-reset address that parameter is the token, so a link pasted with its last
 * character cut in half (`/g/<token>%E2%80`) put the whole credential into the error log
 * through the error handler's own line. This reads every byte the process wrote on every
 * channel, from the real app logger and a real, enabled access log, the same net
 * `logCanary.test.ts` casts over the route table with well-formed paths.
 *
 * The handler's behaviour — the 400, what the body says, what each family of address
 * answers — is `malformedPath.test.ts`.
 */

const TOKEN = 'canary-token-5d1f8a3c9e7b2640'
const BROKEN = '%E0%A4%A'
const INSTANCE = { service: 'eventslide', version: 'malformed-path', instance: 'malformed-box' }

/** Every address whose last segment is a credential, with the break after it. */
const CREDENTIAL_PATHS: readonly string[] = [
  `/api/gallery/${TOKEN}${BROKEN}`,
  `/api/gallery/${TOKEN}${BROKEN}/photos`,
  `/api/gallery/${TOKEN}${BROKEN}/unlock`,
  `/g/${TOKEN}${BROKEN}`,
  `/g/${TOKEN}${BROKEN}/anything`,
  `/invite/${TOKEN}${BROKEN}`,
  `/password/reset/${TOKEN}${BROKEN}`,
  `/api/invitations/${TOKEN}${BROKEN}`,
]

describe('a link cut in the middle of a percent-escape', () => {
  let clientDir: string

  beforeAll(async () => {
    clientDir = await mkdtemp(join(tmpdir(), 'eventslide-malformed-canary-'))
    await writeFile(join(clientDir, 'index.html'), '<!doctype html>', 'utf8')
  })

  afterAll(async () => {
    await rm(clientDir, { recursive: true, force: true })
  })

  const write = async (): Promise<string> => {
    const logger = createPinoLogger({ level: 'trace', pretty: false, bindings: INSTANCE })
    const harness = buildServerHarness({
      clientDir,
      logger,
      config: { accessLog: { enabled: true, level: 'trace', pretty: false, ...INSTANCE } },
    })
    return captureAllOutputWhile(async () => {
      for (const path of CREDENTIAL_PATHS) await request(harness.app).get(path)
    })
  }

  it('writes neither the token nor a stack anywhere in the log', async () => {
    const output = await write()

    expect(output).not.toContain(TOKEN)
    expect(output).not.toContain('"stack"')
    expect(output).not.toContain('unhandled error')
    expect(output).not.toContain('Failed to decode')
  })

  it('actually wrote something, so "no token found" is not "nothing was captured"', async () => {
    const output = await write()

    // One access line per address, none of them a 5xx. It is a 400 or a 404 and not one of
    // them: the gallery and invitation routers answer the router's decode failure with a 404 of
    // their own (`gallery.notAvailable`, `invitation.notFound`), and write no line of the app
    // logger's. And the handler's own line, with the path written as `:token`, for the pages.
    expect(output).toContain(INSTANCE.instance)
    expect(output.match(/"statusCode":(?:400|404)/g)).toHaveLength(CREDENTIAL_PATHS.length)
    expect(output).not.toMatch(/"statusCode":5\d\d/)
    expect(output).toContain('"path":"/g/:token"')
    expect(output).toContain('"path":"/invite/:token"')
    expect(output).toContain('"path":"/password/reset/:token"')
  })
})
