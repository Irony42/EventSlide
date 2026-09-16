import http from 'node:http'
import type { AddressInfo } from 'node:net'
import supertest from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  openStream as openStreamFor,
  resetSignalLogs,
  streamHandler,
  streamRoutes,
} from './streamRoutes'
import {
  buildHarness,
  buildTestWorld,
  signInAs,
  type Harness,
  type TestWorld,
} from '../testing/middlewareHarness'
import { SseSink, asResponse } from '../testing/sseSink'
import { AT, anEvent } from '../../../application/testing/builders'
import { asEventId, asPhotoId, asUserId } from '../../../domain/shared/ids'
import { DomainError } from '../../../domain/shared/errors'
import { err } from '../../../domain/shared/result'
import type { DomainEvent, EventBus } from '../../../application/ports/eventBus'

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

/**
 * A bus with no room left, which is what the two-hundred-and-first connection to an
 * event meets.
 *
 * A fake rather than two hundred real sockets: *when* the in-memory adapter refuses is
 * its own rule and has its own tests in `src/infrastructure/realtime/`. What only this
 * ring can answer is what the route does with a refusal — and the answer has to be
 * visible on the wire, because the defect it replaces was invisible there.
 */
const busAtCapacity = (): EventBus => ({
  publish: () => {},
  subscribe: () => err(DomainError.unexpected('service.notReady')),
  // The clip worker's channel. Uncapped, and beside the point of this double.
  subscribeAll: () => () => {},
})

/** Every `id:` a client was sent, in order. */
const idsIn = (stream: Stream): string[] =>
  [...stream.frames.join('').matchAll(/^id: (\d+)$/gm)].map(([, id]) => id ?? '')

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

  it('gives two clients of one event the same id for one change', async () => {
    // The id was minted inside each subscriber's callback, so one photo became id 1 for
    // the projector and id 1 for the console — two private id spaces wearing the same
    // numbers, and a sixty-four entry replay ring consumed once per connected screen.
    // With six screens the real replay window was ten signals.
    const projector = await open('/api/events/mariage/stream')
    await projector.waitFor((text) => text.includes(': connected'), 'the projector')
    const moderator = await open('/api/events/mariage/stream')
    await moderator.waitFor((text) => text.includes(': connected'), 'the console')

    subject.deps.bus.publish(photoPublished(WEDDING))
    subject.deps.bus.publish(photoPublished(WEDDING))

    await projector.waitFor((text) => text.includes('id: 2'), 'the projector’s second signal')
    await moderator.waitFor((text) => text.includes('id: 2'), 'the console’s second signal')
    // Two changes, two ids, the same two for both — not one each.
    expect(idsIn(projector)).toEqual(['1', '2'])
    expect(idsIn(moderator)).toEqual(['1', '2'])
  })

  it('records one replay entry per change, not one per connected client', async () => {
    // The other half of the same defect, and the expensive half: the entry was appended
    // from inside each subscriber's callback, so the sixty-four entry ring was consumed
    // once per screen. A projector, two consoles and three phones turned a replay window
    // of sixty-four signals into one of about ten, and a client that reconnected
    // replayed the same change as many times as there were clients watching.
    const projector = await open('/api/events/mariage/stream')
    await projector.waitFor((text) => text.includes(': connected'), 'the projector')
    const moderator = await open('/api/events/mariage/stream')
    await moderator.waitFor((text) => text.includes(': connected'), 'the console')

    subject.deps.bus.publish(photoPublished(WEDDING))
    await moderator.waitFor((text) => text.includes('id: 1'), 'the signal')

    const arriving = await open('/api/events/mariage/stream')
    await arriving.waitFor((text) => text.includes('event: change'), 'the replay')

    expect(idsIn(arriving)).toEqual(['1'])
  })

  it('replays what a reconnecting client missed', async () => {
    // A projector that drops for thirty seconds must not miss the photos published
    // while it was away. The console stays connected throughout, which is what holds
    // the event's replay buffer open — an event nobody is watching keeps none, as the
    // next test says.
    const moderator = await open('/api/events/mariage/stream')
    await moderator.waitFor((text) => text.includes(': connected'), 'the console')
    const first = await open('/api/events/mariage/stream')
    await first.waitFor((text) => text.includes(': connected'), 'connection')
    subject.deps.bus.publish(photoPublished(WEDDING))
    await first.waitFor((text) => text.includes('id: 1'), 'the first signal')
    first.close()

    subject.deps.bus.publish(photoPublished(WEDDING))
    subject.deps.bus.publish(photoPublished(WEDDING))
    await moderator.waitFor((text) => text.includes('id: 3'), 'the signals it was away for')

    const reconnected = await open('/api/events/mariage/stream', { 'last-event-id': '1' })

    await reconnected.waitFor((text) => text.includes('id: 3'), 'the replayed signals')
    const text = reconnected.frames.join('')
    expect(text).toContain('id: 2')
    // Already seen, so it must not be replayed.
    expect(text).not.toContain('id: 1\n')
  })

  it('keeps no replay buffer for an event whose last client has left', async () => {
    // The buffer belongs to the event's live channel and goes when the last connection
    // does. It used to be a module-level map held for the lifetime of the process, so a
    // purged event left its buffer behind for good — state with no owner, outliving the
    // thing it described. Losing the replay costs nothing: a client refetches the wall
    // on every connect, which is what makes replay an optimisation rather than the
    // mechanism by which the wall stays correct.
    const only = await open('/api/events/mariage/stream')
    await only.waitFor((text) => text.includes(': connected'), 'connection')
    subject.deps.bus.publish(photoPublished(WEDDING))
    await only.waitFor((text) => text.includes('id: 1'), 'the first signal')

    only.close()
    await expect
      .poll(() => subject.bus.subscriberCount(asEventId(WEDDING)), { timeout: 3_000 })
      .toBe(0)

    const later = await open('/api/events/mariage/stream')
    await later.waitFor((text) => text.includes(': connected'), 'the new connection')
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(later.frames.join('')).not.toContain('event: change')
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
    expect(subject.bus.subscriberCount(asEventId(WEDDING))).toBe(1)

    stream.close()

    // An eight-hour run with a projector that reconnects every few minutes would
    // otherwise accumulate a listener per connection.
    await expect
      .poll(() => subject.bus.subscriberCount(asEventId(WEDDING)), { timeout: 3_000 })
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

  it('refuses a connection the bus has no room for, with 503 and no stream', async () => {
    // The merge blocker this replaces. Past the per-event cap the bus returned a no-op
    // unsubscribe, the route could not tell that from a live subscription, and the
    // client was answered 200, the event-stream headers, `: connected` and a heartbeat
    // every fifteen seconds — and never one `change` frame, for the rest of the
    // evening. The wall stopped updating while displaying "connected", and the channel
    // needs no authentication, so two hundred `EventSource`s from one laptop were
    // enough to do it to someone else's wedding.
    const full = buildHarness({
      routes: (app, deps) => {
        app.use('/api', streamRoutes({ ...deps, bus: busAtCapacity() }))
      },
    })
    full.events.seed(anEvent({ slug: 'mariage', status: 'live', joinCode: 'H7K2QM' }))
    const fullServer = http.createServer(full.app)
    await new Promise<void>((resolve) => fullServer.listen(0, '127.0.0.1', resolve))
    const fullPort = (fullServer.address() as AddressInfo).port

    try {
      const refused = await openStream(fullPort, '/api/events/mariage/stream')
      await refused.waitFor((text) => text.includes('service.notReady'), 'the refusal')

      expect(refused.statusCode).toBe(503)
      // Refused as a request, never begun as a stream: a client that has been handed
      // `text/event-stream` has been told the connection is good.
      expect(refused.headers['content-type']).toContain('application/json')
      expect(refused.headers['content-type']).not.toContain('text/event-stream')
      expect(refused.headers['retry-after']).toBe('30')
      expect(refused.frames.join('')).not.toContain(': connected')
    } finally {
      await new Promise<void>((resolve) => fullServer.close(() => resolve()))
    }
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

/**
 * The stream itself, driven without a socket.
 *
 * `openStream` is exported for this: a heartbeat fires on a fifteen-second interval, and
 * the guards that refuse to write to a response whose socket has already gone exist for
 * a race no socket test can schedule. Here the interval is driven by fake timers and
 * "the socket is gone" is a property the test sets, so both are decided rather than
 * waited for.
 */
describe('openStream', () => {
  let world: TestWorld

  beforeEach(() => {
    resetSignalLogs()
    world = buildTestWorld()
    // Nothing in this block awaits a real timer, so the heartbeat can simply be driven.
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const open = (lastEventId?: string): SseSink => {
    const sink = new SseSink()
    openStreamFor({
      deps: world.deps,
      logger: world.deps.logger,
      eventId: asEventId(WEDDING),
      lastEventId,
      res: asResponse(sink),
    })
    return sink
  }

  it('flushes the headers rather than leaving them to ride out with the first frame', () => {
    // A client reports the connection open on the headers, and the first photo may be
    // minutes away. Today the `: connected` comment frame would push them out anyway, so
    // this is the assertion that keeps the two independent: remove the comment frame and
    // the projector would otherwise sit on a pending request until someone uploads.
    const sink = open()

    expect(sink.headersFlushed).toBe(true)
  })

  it('emits a comment frame on the heartbeat interval, so a proxy sees traffic', () => {
    // Proxies and mobile networks close an idle connection after 30–60 seconds. 1.0
    // sent nothing between events, so a quiet spell ended the stream and the wall
    // stopped updating for the rest of the night with nothing on screen to say so.
    const sink = open()

    vi.advanceTimersByTime(15_000)

    expect(sink.text).toContain(': keep-alive')
  })

  it('names the heartbeat too, so a client can tell quiet from dead', () => {
    // A comment reaches no client handler, which is what makes it safe for a proxy and
    // useless as a sign of life. The named half is what the client's watchdog listens
    // for; it carries no `id:`, so it never moves a reconnecting client's cursor.
    const sink = open()

    vi.advanceTimersByTime(15_000)

    expect(sink.text).toContain('event: ping')
    expect(sink.text).not.toContain('id:')
  })

  it('writes nothing at all when the bus has no room for the connection', () => {
    // The whole point of subscribing before writing: the status is still ours to choose.
    // A refusal discovered after `writeHead(200)` cannot be answered, only abandoned —
    // and an abandoned stream is what the projector reports as "connected".
    const sink = new SseSink()

    const result = openStreamFor({
      deps: { ...world.deps, bus: busAtCapacity() },
      logger: world.deps.logger,
      eventId: asEventId(WEDDING),
      lastEventId: undefined,
      res: asResponse(sink),
    })

    expect(result.ok).toBe(false)
    expect(sink.status).toBe(0)
    expect(sink.headersFlushed).toBe(false)
    expect(sink.frames).toEqual([])
    // Nothing left running either: a refused connection that armed a heartbeat would
    // hold an interval for a response nobody is reading.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('writes no heartbeat to a response whose socket has already gone', () => {
    const sink = open()
    sink.endWriting()

    vi.advanceTimersByTime(15_000)

    expect(sink.text).not.toContain(': keep-alive')
  })

  it('writes no signal to a response whose socket has already gone', () => {
    // The bus delivers synchronously, so a connection that died between the publish and
    // the write is reachable — and writing to it would throw inside `publish`, which the
    // port promises never throws so that a slow projector cannot fail a guest's upload.
    const sink = open()
    sink.endWriting()

    world.deps.bus.publish(photoPublished(WEDDING))

    expect(sink.text).not.toContain('event: change')
    expect(world.bus.listenerErrors).toEqual([])
  })

  it('stops the heartbeat once the client has disconnected', () => {
    // An eight-hour run with a projector that reconnects every few minutes would
    // otherwise accumulate one interval per connection.
    const sink = open()

    sink.emit('close')

    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps another client of the same event when one connection errors then closes', () => {
    // A handler plausibly tears down on both `error` and `close`. Doing both must not
    // take a concurrently connected projector's subscription with it.
    const failing = open()
    const healthy = open()

    failing.emit('error', new Error('ECONNRESET'))
    failing.emit('close')

    world.deps.bus.publish(photoPublished(WEDDING))
    expect(healthy.text).toContain('event: change')
    expect(world.bus.subscriberCount(asEventId(WEDDING))).toBe(1)
  })

  it('unsubscribes after an error value that is not an Error', () => {
    // Node emits whatever the socket layer hands it. A handler that assumed `.message`
    // would throw from inside an error listener, which takes the process down.
    const sink = open()

    sink.emit('error', 'the socket layer said something else')

    expect(world.bus.subscriberCount(asEventId(WEDDING))).toBe(0)
  })

  it('replays at most the most recent signals, so an idle event bounds its memory', () => {
    // The buffer closes the gap during a reconnect; it is not a durable log. The client
    // refetches the wall on every connect, so dropping the oldest signal costs nothing
    // while an unbounded buffer would grow for eight hours.
    const watching = open()
    for (let i = 0; i < 65; i += 1) world.deps.bus.publish(photoPublished(WEDDING))
    expect(watching.text).toContain('id: 65\n')

    const reconnected = open()

    expect(reconnected.text).not.toContain('id: 1\n')
    expect(reconnected.text).toContain('id: 2\n')
  })
})

describe('streamHandler', () => {
  it('fails closed when no middleware resolved the event', async () => {
    // Unreachable behind `resolvePublicEvent` or `requireRole`, and that is why it is
    // asserted: a route that ever loses its authorization decision must answer 404
    // rather than dereference an absent event, which a `!` would turn into a
    // `TypeError` on a projector at 22:00 answered as a 500 after the fact.
    const subject = buildHarness({
      routes: (app, deps) => {
        app.get('/events/:eventSlug/unguarded-stream', streamHandler(deps))
      },
    })

    const response = await supertest(subject.app).get('/events/mariage/unguarded-stream')

    expect(response.status).toBe(404)
    expect(subject.bus.subscriberCount()).toBe(0)
  })
})
