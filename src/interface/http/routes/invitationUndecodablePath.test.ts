import request from 'supertest'
import { describe, expect, it } from 'vitest'
import type { Logger, LogContext } from '../../../application/ports/logger'
import { buildHarness } from '../testing/middlewareHarness'
import { invitationRoutes } from './invitationRoutes'

/**
 * Which errors the invitation router files under "a dead link".
 *
 * Express decodes `:token` while it matches the route and, when it cannot, throws a `URIError`
 * that it stamps `status: 400` (`router/lib/layer.js`, the only place that does). That is a
 * malformed link, answered like every other dead one: `404 invitation.notFound`, and the
 * routes' own test file holds that for `%`, `%zz` and a cut escape. What is held here is the
 * other side, the same one the gallery router holds in `malformedPath.test.ts`: the router
 * answers **its own** refusal and nothing wider. A `URIError` raised by the invitation code
 * (a `decodeURIComponent` on a header, say) has no status, and filing it as a dead link would
 * hide a bug as a quiet 404 with nothing in the log.
 *
 * Kept apart from `invitationRoutes.test.ts` on purpose: that file's harness builds the real
 * use cases, and these need ones that fail.
 */

const TOKEN = 'a'.repeat(43)

/** The minimal body of the password branch of `POST /invitations/:token/accept`. */
const CREDENTIALS = { password: 'une phrase de passe 2026', displayName: 'Camille Dupont' }

const NOT_FOUND = { error: { code: 'invitation.notFound' } }
const UNEXPECTED = { error: { code: 'server.unexpected' } }

/** Keeps what the app logged, so a test can say that a 500 left its line in the log. */
class RecordingLogger implements Logger {
  readonly messages: string[] = []

  constructor(messages?: string[]) {
    if (messages !== undefined) this.messages = messages
  }

  private record(message: string): void {
    this.messages.push(message)
  }

  debug(message: string): void {
    this.record(message)
  }

  info(message: string): void {
    this.record(message)
  }

  warn(message: string): void {
    this.record(message)
  }

  error(message: string): void {
    this.record(message)
  }

  child(_bindings: LogContext): Logger {
    return new RecordingLogger(this.messages)
  }
}

const harnessFailingWith = (fail: () => never, logger: Logger = new RecordingLogger()) =>
  buildHarness({
    logger,
    routes: (app, deps) => {
      app.use(
        '/api',
        invitationRoutes({
          deps,
          usecases: {
            previewInvitation: async () => fail(),
            acceptInvitation: async () => fail(),
          },
        }),
      )
    },
  })

describe('the invitation router and an error that is not its own', () => {
  it('still answers a malformed token like a dead link, which is the router’s own refusal', async () => {
    const subject = harnessFailingWith(() => {
      throw new Error('the use case must not be reached')
    })

    const response = await request(subject.app).get('/api/invitations/%E0%A4%A')

    expect(response.status).toBe(404)
    expect(response.body).toMatchObject(NOT_FOUND)
  })

  describe.each([
    [
      'GET /api/invitations/:token',
      (app: Parameters<typeof request>[0]) => request(app).get(`/api/invitations/${TOKEN}`),
    ],
    [
      'POST /api/invitations/:token/accept',
      // The one public route that takes a body. If the body it needs grows a field, this
      // goes red with a 400 rather than passing: add the field to CREDENTIALS.
      (app: Parameters<typeof request>[0]) =>
        request(app).post(`/api/invitations/${TOKEN}/accept`).send(CREDENTIALS),
    ],
  ])('%s', (_route, call) => {
    it('does not file a URIError the invitation code raised itself under a dead link', async () => {
      // No `status`: Express stamped none, because it did not throw this one. A 404 here would
      // hide a defect in this codebase behind the answer a stranger probing links gets.
      const logger = new RecordingLogger()
      const subject = harnessFailingWith(() => {
        decodeURIComponent('%E0%A4%A')
        throw new Error('unreachable')
      }, logger)

      const response = await call(subject.app)

      expect(response.status).toBe(500)
      expect(response.body).toMatchObject(UNEXPECTED)
      // And it is a bug that says so: the error handler's own line, with its stack.
      expect(logger.messages).toContain('unhandled error')
    })

    it('does not file an error some library stamped 400 under a dead link either', async () => {
      // The class is half of the test: `status` is set by `http-errors` on anything a
      // dependency chose to throw with one, and the router did not decide that this is a
      // bad link.
      const logger = new RecordingLogger()
      const subject = harnessFailingWith(() => {
        throw Object.assign(new Error('a library chose a status'), { status: 400 })
      }, logger)

      const response = await call(subject.app)

      expect(response.status).toBe(500)
      expect(response.body).toMatchObject(UNEXPECTED)
      expect(logger.messages).toContain('unhandled error')
    })
  })
})
