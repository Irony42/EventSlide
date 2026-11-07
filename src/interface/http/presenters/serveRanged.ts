import type { Request, Response } from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Logger } from '../../../application/ports/logger'
import type { ByteRange } from '../../../application/ports/mediaStore'
import { DomainError } from '../../../domain/shared/errors'
import { contentRange, parseByteRange, unsatisfiedRange } from './byteRange'
import { errorBody, sendError } from './send'

/**
 * Streams an iterable to the response, and abandons the connection if it fails.
 *
 * `pipeline`, never `pipe`: `pipe` leaves the response open when the source errors, so
 * the client would receive a truncated body under the 200 it has every reason to trust.
 * A half-written ZIP looks exactly like a complete album, and a host who then deletes
 * their photos believing they hold a copy has lost them. By the time bytes are flowing
 * the status line is long gone, so destroying the socket is the only signal left that
 * the body is incomplete.
 *
 * The failure is caught here rather than forwarded to the error handler because
 * `pipeline` has already destroyed the response: handing it on would have the error
 * handler write a JSON body to a dead socket.
 */
export const streamOrAbandon = async (
  res: Response,
  logger: Logger,
  message: string,
  chunks: AsyncIterable<Uint8Array>,
): Promise<void> => {
  try {
    await pipeline(Readable.from(chunks), res)
  } catch (error) {
    logger.error(message, { error: error instanceof Error ? error.message : String(error) })
    res.destroy()
  }
}

/** What {@link serveRanged} needs of an object: its size, and the one function that opens its bytes. */
export interface RangedSource {
  readonly byteSize: number
  /** `null` is a row pointing at a file that is gone, not a range outside the object. */
  readonly open: (range?: ByteRange) => Promise<AsyncIterable<Uint8Array> | null>
}

/** The representation a route serves, written the same way on every answer that carries it. */
export interface RangedHeaders {
  readonly contentType: string
  readonly cacheControl: string
  readonly contentDisposition: string
  /** A strong validator. Given, the response can answer `304`; omitted, it never does. */
  readonly etag?: string
  /** Written on the `416` only. A refusal carries no representation headers, so a route that must not be cached says so here. */
  readonly refusalCacheControl?: string
  /** The log line when the stream breaks after the status line has gone. */
  readonly failureMessage: string
}

/**
 * One place that decides `304`, `206`, `416` and when a descriptor is opened, for every route
 * that serves a stored object with `Range` support (HTTP-05; the media routes, the highlight
 * reel and the photo book used to write it four times, and the book's `416` went out as a PDF
 * attachment: HTTP-04).
 *
 * **The order is the fix for a descriptor leak, not a preference.** `openRead` opens the file
 * when the stream is *constructed*, so any answer that opens bytes it does not write costs a
 * descriptor until the garbage collector happens to run. A `<video>` issues a `Range` request
 * per seek and a projector revalidates every slide it already holds, so the count climbs for
 * as long as the party lasts and ends in `EMFILE`, which takes the wall down.
 *
 * So: the range verdict, then the representation headers, then the freshness check, and only
 * then `open`. A `304` and a `416` leave this function having opened nothing at all.
 *
 * **A `416` is a JSON error, not the representation.** It carries `Accept-Ranges` and the
 * `Content-Range` that lets a player correct itself instead of retrying the same impossible
 * range for the rest of the evening, and none of the type, disposition or validator.
 */
export const serveRanged = async (
  req: Request,
  res: Response,
  source: RangedSource,
  headers: RangedHeaders,
): Promise<void> => {
  const verdict = parseByteRange(req.get('range'), source.byteSize)

  if (verdict.kind === 'unsatisfiable') {
    // Written here rather than through the kind table: `DomainErrorKind` has no member for
    // it and should not grow one. It is a property of this representation and of the header
    // that asked for it, not a class of business failure.
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Range', unsatisfiedRange(source.byteSize))
    if (headers.refusalCacheControl !== undefined) {
      res.setHeader('Cache-Control', headers.refusalCacheControl)
    }
    res.status(416).json(errorBody(DomainError.invalid('photo.rangeNotSatisfiable')))
    return
  }
  const range = verdict.kind === 'partial' ? verdict.range : null

  // Set before the freshness check: a 304 must still carry the validator and the caching
  // policy, or a projector revalidates every slide for the rest of the night.
  if (headers.etag !== undefined) res.setHeader('ETag', headers.etag)
  res.setHeader('Cache-Control', headers.cacheControl)
  res.setHeader('Content-Disposition', headers.contentDisposition)
  // **Advertised on every response, not only on a clip.** A media element decides whether
  // it can seek from this header, and it asks about the object before it plays it.
  res.setHeader('Accept-Ranges', 'bytes')

  // `req.fresh` compares `If-None-Match` weakly, as RFC 9110 requires, handles a list of
  // validators and honours a client's own `Cache-Control: no-cache`.
  if (req.fresh) {
    // No body, and deliberately no `Content-Length`: a 304 that declares a length is a
    // response some proxies wait on.
    res.status(304).end()
    return
  }

  // The one open, for the bytes this response is now committed to writing. `null` is not the
  // range being outside the object (answered above, against the size this same read reported).
  const bytes = await source.open(range ?? undefined)
  if (bytes === null) {
    // A missing file is not the representation: drop what was written for it, or a browser
    // caches this 404 as the object for a year.
    res.removeHeader('ETag')
    res.removeHeader('Cache-Control')
    res.removeHeader('Content-Disposition')
    sendError(res, DomainError.notFound('photo.mediaMissing'))
    return
  }

  res.setHeader('Content-Type', headers.contentType)

  if (range === null) {
    // From the store's own metadata, so the declared length is the length that will be written.
    res.setHeader('Content-Length', String(source.byteSize))
  } else {
    // A `206` declares the length of the **part**, and `Content-Range` the whole. Getting the
    // two the wrong way round is how a player stalls at the end of the first chunk.
    res.status(206)
    res.setHeader('Content-Range', contentRange(range, source.byteSize))
    res.setHeader('Content-Length', String(range.end - range.start + 1))
  }

  await streamOrAbandon(res, req.context.logger, headers.failureMessage, bytes)
}
