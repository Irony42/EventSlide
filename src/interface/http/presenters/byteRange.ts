import type { ByteRange } from '../../../application/ports/mediaStore'

/**
 * Parsing a `Range` header, because a `<video>` will not play without one.
 *
 * This is not an optimisation. A browser asked to play an mp4 issues a `Range` request
 * before it will let anyone scrub, and Safari will not begin playback **at all** against
 * a handler that answers `200` with the whole body — it opens a range request, gets a
 * `200`, and gives up. The failure is invisible to CSP, to every unit test, and to rings
 * 1 through 5: it takes a request that actually carries the header.
 *
 * Deliberately narrow. RFC 9110 allows a list of ranges and a multipart response; nothing
 * a media element sends needs one, and `multipart/byteranges` is a body format with its
 * own boundary handling for no benefit here. A list is therefore answered as if no range
 * had been asked for, which is what the RFC permits and what every player handles.
 */

export type RangeVerdict =
  /** No `Range` header, or one this handler does not honour. Serve the whole object. */
  | { readonly kind: 'whole' }
  /** A range inside the object. Answer `206` with a `Content-Range`. */
  | { readonly kind: 'partial'; readonly range: ByteRange }
  /** A syntactically valid range that the object cannot satisfy. Answer `416`. */
  | { readonly kind: 'unsatisfiable' }

/** `bytes=<first>-<last>`, `bytes=<first>-`, or `bytes=-<suffix length>`. */
const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/

export const parseByteRange = (header: string | undefined, size: number): RangeVerdict => {
  if (header === undefined) return { kind: 'whole' }

  const match = SINGLE_RANGE.exec(header.trim())
  // A multi-range request, or a unit this server does not speak. Answering the whole
  // object is allowed and is what a player copes with; a 416 here would break one.
  if (match === null) return { kind: 'whole' }

  const [, rawFirst = '', rawLast = ''] = match
  // `bytes=-` names nothing at all.
  if (rawFirst === '' && rawLast === '') return { kind: 'whole' }

  // A zero-length object can satisfy no range, and `size - 1` would be `-1`.
  if (size <= 0) return { kind: 'unsatisfiable' }

  if (rawFirst === '') {
    // A suffix range: the last N bytes. `bytes=-0` asks for nothing.
    const suffix = Number(rawLast)
    if (suffix === 0) return { kind: 'unsatisfiable' }
    return { kind: 'partial', range: { start: Math.max(0, size - suffix), end: size - 1 } }
  }

  const start = Number(rawFirst)
  if (start >= size) return { kind: 'unsatisfiable' }

  // An open-ended range runs to the end of the object; a closed one is clamped to it,
  // which RFC 9110 requires rather than treating as unsatisfiable.
  const end = rawLast === '' ? size - 1 : Math.min(Number(rawLast), size - 1)
  if (end < start) return { kind: 'unsatisfiable' }

  return { kind: 'partial', range: { start, end } }
}

/** `bytes <start>-<end>/<size>`, as a `206` must carry it. */
export const contentRange = (range: ByteRange, size: number): string =>
  `bytes ${range.start}-${range.end}/${size}`

// `bytes <asterisk>/<size>`, which is what a 416 carries instead of a served range.
// Written as a line comment on purpose: the literal it describes ends a block comment.
export const unsatisfiedRange = (size: number): string => `bytes */${size}`
