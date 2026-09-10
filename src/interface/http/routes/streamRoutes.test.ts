import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetSignalLogs, streamRoutes } from './streamRoutes'
import { buildHarness, signInAs, type Harness } from '../testing/middlewareHarness'
import { AT, anEvent } from '../../../application/testing/builders'
import { asEventId, asPhotoId, asUserId } from '../../../domain/shared/ids'
import type { DomainEvent } from '../../../application/ports/eventBus'

const WEDDING = 'wedding-id'
const GALA = 'gala-id'
const HOST = 'host-id'

/**
 * SSE needs a real socket: supertest buffers a response and resolves when it ends, and
 * this response never ends. So the harness app is put behind an actual listener and the
 * frames are read off the wire as they arrive.
 */
interface Stream {
  readonly frames: string[]
  waitFor(predicate: (text: string) => boolean, label: string): Promise<void>
  readonly statusCode: number
  readonly headers: http.IncomingHttpHeaders
  close(): void
}

const openStream = (
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<Stream> =>
  new Promise((resolve, reject) => {
    const request = http.get({ port, path, headers }, (response) => {
      const frames: string[] = []
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => frames.push(chunk))
      response.on('error', reject)

      resolve({
        frames,
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        waitFor: (predicate, label) =>
          new Promise((settle, fail) => {
            const check = (): boolean => predicate(frames.join(''))
            if (check()) {
              settle()
              return
            }
            const timer = setTimeout(() => {
              response.off('data', onData)
              fail(new Error(`timed out waiting for ${label}; saw: ${JSON.stringify(frames)}`))
            }, 3_000)
            const onData = (): void => {
              if (!check()) return
              clearTimeout(timer)
              response.off('data', onData)
              settle()
            }
            response.on('data', onData)
          }),
        close: () => {
          request.destroy()
          response.destroy()
        },
      })
    })
    request.on('error', reject)
  })

const photoPublished = (eventId: string): DomainEvent => ({
  type: 'photo.moderated',
  eventId: asEventId(eventId),
  photoId: asPhotoId('photo-1'),
  status: 'published',
})

describe('streamRoutes', () => {
  let subject: Harness
  let server: http.Server
  let port: number
  const streams: Stream[] = []

  beforeEach(async () => {
    resetSignalLogs()
    subject = buildHarness({
      routes: (app, deps) => {
        app.post('/sign-in', signInAs({ userId: HOST, email: 'host@example.com' }))
        app.use('/api', streamRoutes(deps))
      },
    })
    subject.events.seed(
      anEvent({ id: WEDDING, slug: 'mariage', status: 'live', joinCode: 'H7K2QM' }),
      anEvent({ id: GALA, slug: 'gala', status: 'live', joinCode: 'B4N9PT' }),
    )
    subject.memberships.seed({
      eventId: asEventId(WEDDING),
      userId: asUserId(HOST),
      role: 'owner',
      grantedAt: AT,
    })

    server = http.createServer(subject.app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterEach(async () => {
    for (const stream of streams.splice(0)) stream.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  const open = async (path: string, headers?: Record<string, string>): Promise<Stream> => {
    const stream = await openStream(port, path, headers)
    streams.push(stream)
    return stream
  }

  it('sets the headers that stop a proxy buffering the stream', async () => {
    // Without these the wall looks frozen while photos are in fact arriving, because
    // nginx buffers a proxied response by default.
    const stream = await open('/api/events/mariage/stream')

    expect(stream.statusCode).toBe(200)
    expect(stream.headers['content-type']).toContain('text/event-stream')
    expect(stream.headers['cache-control']).toContain('no-transform')
    expect(stream.headers['x-accel-buffering']).toBe('no')
  })

  it('sends a comment frame immediately, before any photo exists', async () => {
    const stream = await open('/api/events/mariage/stream')

    await stream.waitFor((text) => text.includes(': connected'), 'the initial comment frame')
  })

  it('delivers a signal when something changes in that event', async () => {
    const stream = await open('/api/events/mariage/stream')
    await stream.waitFor((text) => text.includes(': connected'), 'connection')

    subject.deps.bus.publish(photoPublished(WEDDING))

    await stream.waitFor((text) => text.includes('event: change'), 'a change signal')
    expect(stream.frames.join('')).toContain('"type":"photo.moderated"')
  })

  it('carries an id on every frame, so a reconnect can resume', async () => {
    const stream = await open('/api/events/mariage/stream')
    await stream.waitFor((text) => text.includes(': connected'), 'connection')

    subject.deps.bus.publish(photoPublished(WEDDING))

    await stream.waitFor((text) => text.includes('id: 1'), 'the first frame id')
  })

  it('never delivers another event’s activity', async () => {
    // 1.0 had one global emitter and every listener filtered by party name inside its
    // own callback, so this isolation was a comparison someone had to remember.
    const stream = await open('/api/events/mariage/stream')
    await stream.waitFor((text) => text.includes(': connected'), 'connection')

    subject.deps.bus.publish(photoPublished(GALA))
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(stream.frames.join('')).not.toContain('event: change')
  })

  it('replays what a reconnecting client missed', async () => {
    // A projector that drops for thirty seconds must not miss the photos published
    // while it was away.
    const first = await open('/api/events/mariage/stream')
    await first.waitFor((text) => text.includes(': connected'), 'connection')
    subject.deps.bus.publish(photoPublished(WEDDING))
    await first.waitFor((text) => text.includes('id: 1'), 'the first signal')
    first.close()

    subject.deps.bus.publish(photoPublished(WEDDING))
    subject.deps.bus.publish(photoPublished(WEDDING))

    const reconnected = await open('/api/events/mariage/stream', { 'last-event-id': '1' })

    await reconnected.waitFor((text) => text.includes('id: 3'), 'the replayed signals')
    const text = reconnected.frames.join('')
    expect(text).toContain('id: 2')
    // Already seen, so it must not be replayed.
    expect(text).not.toContain('id: 1\n')
  })

  it.each([
    ['a non-numeric value', 'banana'],
    ['a negative value', '-5'],
    ['an empty value', ''],
  ])('treats %s in Last-Event-ID as "from the start"', async (_label, lastEventId) => {
    // A first connection is needed for the signal to be recorded at all: the log is
    // appended on delivery, so an event with no connected client buffers nothing. See
    // the note on REPLAY_BUFFER — the client refetches on connect, so that costs
    // nothing.
    const first = await open('/api/events/mariage/stream')
    await first.waitFor((text) => text.includes(': connected'), 'connection')
    subject.deps.bus.publish(photoPublished(WEDDING))
    await first.waitFor((text) => text.includes('id: 1'), 'the first signal')

    const stream = await open('/api/events/mariage/stream', { 'last-event-id': lastEventId })

    // A garbage header must replay everything rather than being trusted as a cursor.
    await stream.waitFor((text) => text.includes('id: 1'), 'a replay from the start')
  })

  it('does not buffer signals for an event nobody is watching', async () => {
    // Documented behaviour rather than an accident: the alternative is holding a
    // buffer for every event the process has ever seen.
    subject.deps.bus.publish(photoPublished(WEDDING))

    const stream = await open('/api/events/mariage/stream')
    await stream.waitFor((text) => text.includes(': connected'), 'connection')
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(stream.frames.join('')).not.toContain('event: change')
  })

  it('unsubscribes from the bus when the client disconnects', async () => {
    const stream = await open('/api/events/mariage/stream')
    await stream.waitFor((text) => text.includes(': connected'), 'connection')
    expect(subject.deps.bus.subscriberCount(asEventId(WEDDING))).toBe(1)

    stream.close()

    // An eight-hour run with a projector that reconnects every few minutes would
    // otherwise accumulate a listener per connection.
    await expect
      .poll(() => subject.deps.bus.subscriberCount(asEventId(WEDDING)), { timeout: 3_000 })
      .toBe(0)
  })

  it.each(['draft', 'archived'] as const)(
    'refuses the public channel for a %s event',
    async (status) => {
      subject.events.seed(anEvent({ slug: 'secret', status, joinCode: 'Z9Z9Z9' }))

      const stream = await open('/api/events/secret/stream')

      expect(stream.statusCode).toBe(404)
    },
  )

  it('refuses the moderation channel without a session', async () => {
    const stream = await open('/api/events/mariage/moderation/stream')

    expect(stream.statusCode).toBe(401)
  })

  it('serves the moderation channel to a moderator of that event', async () => {
    // The session cookie has to be carried by hand here, since this is a raw socket
    // rather than a supertest agent.
    const signIn = await new Promise<string>((resolve, reject) => {
      const request = http.request({ port, path: '/sign-in', method: 'POST' }, (response) => {
        const cookie = response.headers['set-cookie']?.[0]?.split(';')[0]
        if (cookie === undefined) reject(new Error('no session cookie'))
        else resolve(cookie)
        response.resume()
      })
      request.on('error', reject)
      request.end()
    })

    const stream = await open('/api/events/mariage/moderation/stream', { cookie: signIn })

    expect(stream.statusCode).toBe(200)
    await stream.waitFor((text) => text.includes(': connected'), 'connection')
  })
})
