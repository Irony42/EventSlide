import express from 'express'
import { describe, expect, it } from 'vitest'
import type { ByteRange } from '../../../application/ports/mediaStore'
import { CapturingLogger } from '../../../application/testing/capturingLogger'
import request from '../testing/request'
import { serveRanged, type RangedHeaders, type RangedSource } from './serveRanged'

/**
 * The one place a stored object's `Range` negotiation is decided (HTTP-05). The routes that use
 * it check their own headers; this file checks the rules every one of them shares, once.
 */

const BYTES = Uint8Array.from({ length: 64 }, (_unused, index) => index)

interface World {
  readonly app: express.Express
  readonly logger: CapturingLogger
  /** Every `open`, with the range it was asked for. */
  readonly opened: (ByteRange | undefined)[]
}

const HEADERS: RangedHeaders = {
  contentType: 'video/mp4',
  cacheControl: 'private, max-age=60',
  contentDisposition: 'inline',
  etag: '"abc"',
  failureMessage: 'served object failed mid-stream',
}

const worldFor = (
  headers: RangedHeaders,
  open?: (range?: ByteRange) => Promise<AsyncIterable<Uint8Array> | null>,
): World => {
  const logger = new CapturingLogger()
  const opened: (ByteRange | undefined)[] = []
  const source: RangedSource = {
    byteSize: BYTES.length,
    open:
      open ??
      (async (range) => {
        opened.push(range)
        const part = range === undefined ? BYTES : BYTES.subarray(range.start, range.end + 1)
        return (async function* () {
          yield part
        })()
      }),
  }
  const app = express()
  app.use((req, _res, next) => {
    req.context = { requestId: 'test', logger }
    next()
  })
  app.get('/object', (req, res, next) => {
    serveRanged(req, res, source, headers).catch(next)
  })
  return { app, logger, opened }
}

interface Answer {
  readonly name: string
  readonly range: string | undefined
  readonly status: number
  readonly contentRange: string | undefined
  readonly length: string
  readonly first: number
}

const ANSWERS: readonly Answer[] = [
  {
    name: 'the whole object',
    range: undefined,
    status: 200,
    contentRange: undefined,
    length: '64',
    first: 0,
  },
  {
    name: 'a closed range',
    range: 'bytes=8-15',
    status: 206,
    contentRange: 'bytes 8-15/64',
    length: '8',
    first: 8,
  },
  {
    name: 'an open-ended range',
    range: 'bytes=60-',
    status: 206,
    contentRange: 'bytes 60-63/64',
    length: '4',
    first: 60,
  },
  {
    name: 'a suffix range',
    range: 'bytes=-4',
    status: 206,
    contentRange: 'bytes 60-63/64',
    length: '4',
    first: 60,
  },
  {
    name: 'a multi-range request, as the whole',
    range: 'bytes=0-3,8-11',
    status: 200,
    contentRange: undefined,
    length: '64',
    first: 0,
  },
]

describe('serveRanged', () => {
  it.each(ANSWERS)(
    'answers $name with its status, length and the representation headers',
    async (answer) => {
      const world = worldFor(HEADERS)
      const call = request(world.app).get('/object')
      const response = await (
        answer.range === undefined ? call : call.set('Range', answer.range)
      ).buffer(true)

      expect(response.status).toBe(answer.status)
      expect(response.headers['content-range']).toBe(answer.contentRange)
      expect(response.headers['content-length']).toBe(answer.length)
      expect(response.body[0]).toBe(answer.first)
      expect(response.headers['content-type']).toBe('video/mp4')
      expect(response.headers['cache-control']).toBe('private, max-age=60')
      expect(response.headers['content-disposition']).toBe('inline')
      expect(response.headers['etag']).toBe('"abc"')
      expect(response.headers['accept-ranges']).toBe('bytes')
      expect(world.opened).toHaveLength(1)
    },
  )

  it.each(['bytes=64-', 'bytes=999-', 'bytes=-0', 'bytes=9-3'])(
    'answers 416 for %s with the real size, as JSON, and opens nothing',
    async (range) => {
      const world = worldFor(HEADERS)

      const response = await request(world.app).get('/object').set('Range', range)

      expect(response.status).toBe(416)
      expect(response.headers['content-range']).toBe('bytes */64')
      expect(response.headers['accept-ranges']).toBe('bytes')
      expect(response.headers['content-type']).toContain('application/json')
      expect(response.body.error.code).toBe('photo.rangeNotSatisfiable')
      expect(response.headers['content-disposition']).toBeUndefined()
      expect(response.headers['cache-control']).toBeUndefined()
      expect(world.opened).toHaveLength(0)
    },
  )

  it('puts the refusal cache policy on a 416 only when the route names one', async () => {
    const world = worldFor({ ...HEADERS, refusalCacheControl: 'no-store' })

    const refused = await request(world.app).get('/object').set('Range', 'bytes=99-')
    const served = await request(world.app).get('/object')

    expect(refused.headers['cache-control']).toBe('no-store')
    expect(served.headers['cache-control']).toBe('private, max-age=60')
  })

  it('answers 304 to a validator it already holds, keeping the headers and opening nothing', async () => {
    const world = worldFor(HEADERS)

    const response = await request(world.app).get('/object').set('If-None-Match', '"abc"')

    expect(response.status).toBe(304)
    expect(response.headers['etag']).toBe('"abc"')
    expect(response.headers['cache-control']).toBe('private, max-age=60')
    expect(response.headers['accept-ranges']).toBe('bytes')
    expect(response.headers['content-length']).toBeUndefined()
    expect(world.opened).toHaveLength(0)
  })

  it('never answers 304 without a validator, and writes no ETag', async () => {
    const { etag: _etag, ...withoutEtag } = HEADERS
    const world = worldFor(withoutEtag)

    const response = await request(world.app).get('/object').set('If-None-Match', '"abc"')

    expect(response.status).toBe(200)
    expect(response.headers['etag']).toBeUndefined()
    expect(world.opened).toHaveLength(1)
  })

  it('answers 404 photo.mediaMissing when the row points at a file that is gone', async () => {
    const world = worldFor(HEADERS, async () => null)

    const response = await request(world.app).get('/object')

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('photo.mediaMissing')
    expect(response.headers['content-type']).toContain('application/json')
    // A missing file is not the representation: nothing may cache it as one for a year.
    expect(response.headers['cache-control']).toBeUndefined()
    expect(response.headers['content-disposition']).toBeUndefined()
  })

  it('logs under the route message and abandons the connection when the stream breaks', async () => {
    const world = worldFor(HEADERS, async () =>
      (async function* () {
        yield BYTES.subarray(0, 4)
        throw new Error('disk gone')
      })(),
    )

    await expect(request(world.app).get('/object')).rejects.toThrow()

    expect(world.logger.lines).toEqual([
      {
        level: 'error',
        message: 'served object failed mid-stream',
        context: { error: 'disk gone' },
      },
    ])
  })
})
