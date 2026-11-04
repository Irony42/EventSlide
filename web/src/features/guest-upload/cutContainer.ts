/**
 * Cut the part a guest kept out of a MP4 / MOV on the phone, without re-encoding (spec 16, PR 3).
 *
 * Only the chosen part goes up a venue's Wi-Fi, and a recording over `MAX_CLIP_BYTES` can be
 * trimmed at all. The server still re-encodes whatever arrives (never a remux: metadata and
 * extra tracks are stripped there), so this is a courtesy in bytes, not a security step: a
 * cut that is wrong costs the guest a slightly different extract, never the evening.
 *
 * Done with `mp4box` **loaded on demand** (`import()` below, and nowhere else): the upload
 * page's own bundle does not carry it, only the trim flow fetches it, and only once a guest
 * actually presses "Envoyer cet extrait".
 *
 * How it cuts:
 * 1. Read the boxes only (`createFile(false)` skips the media data, so a `moov` at the end,
 *    as iPhones write it, costs one jump rather than the whole file) and the sample tables.
 * 2. Pick the **last keyframe at or before the start**, and every sample up to the end.
 * 3. Rebuild a small fragmented MP4 from just those samples, in a second parser fed only the
 *    `ftyp`, the `moov` and the byte window those samples occupy.
 *
 * So the extract begins up to a keyframe's distance before the guest's start (one to two
 * seconds on a phone). The bounds returned are relative to **the bytes sent**, which is what
 * the server's `-ss` / `-t` apply, so the exact cut is still made there.
 *
 * Anything unexpected, a format this does not read, a missing track, an error from the
 * library, answers `null`: the caller falls back to sending the whole file with the range.
 */

/** What the phone sends instead of the original, and where the guest's range lies in it. */
export interface ContainerCut {
  readonly blob: Blob
  readonly startMs: number
  readonly endMs: number
}

/** The tail of audio kept past the end so the last picture has its sound, in seconds. */
const AUDIO_SLACK_S = 0.2

/** How much of the file one read takes while looking for the boxes. */
const SCAN_CHUNK = 1 << 20

import type * as Mp4box from 'mp4box'

const loadMp4box = (): Promise<typeof Mp4box> => import('mp4box')

/** Bytes `[from, to)` of the file; a seam so a test needs no `Blob.arrayBuffer`. */
export type ReadBytes = (from: number, to: number) => Promise<ArrayBuffer>

const readerOf =
  (file: Blob): ReadBytes =>
  (from, to) =>
    file.slice(from, to).arrayBuffer()

interface Sample {
  readonly cts: number
  readonly dts: number
  readonly offset: number
  readonly size: number
  readonly timescale: number
  readonly is_sync: boolean
}

const seconds = (value: number, timescale: number): number => value / timescale

export const cutContainer = async (
  file: Blob,
  startMs: number,
  endMs: number,
  options: { readonly load?: () => Promise<typeof Mp4box>; readonly read?: ReadBytes } = {},
): Promise<ContainerCut | null> => {
  const read = options.read ?? readerOf(file)
  try {
    const { createFile, MP4BoxBuffer, DataStream, Endianness } = await (
      options.load ?? loadMp4box
    )()
    const startS = startMs / 1_000
    const endS = endMs / 1_000

    // Pass 1: the boxes and the sample tables, never the media data.
    const scan = createFile(false)
    let ready = false
    let failed = false
    scan.onError = () => {
      failed = true
    }
    scan.onReady = () => {
      ready = true
    }
    let position = 0
    while (!ready && !failed && position < file.size) {
      const to = Math.min(position + SCAN_CHUNK, file.size)
      const next = scan.appendBuffer(
        MP4BoxBuffer.fromArrayBuffer(await read(position, to), position),
      )
      // The parser says where it wants to read next: past the media data when the index is
      // at the end. An answer that is not ahead of us is a parser that is stuck.
      if (typeof next === 'number' && next > position) position = next
      else if (to >= file.size) break
      else position = to
    }
    if (!ready || failed) return null

    const info = scan.getInfo()
    const video = info.videoTracks[0]
    const audio = info.audioTracks[0]
    const ftyp = scan.ftyp
    const moov = scan.moov
    if (video === undefined || ftyp === undefined || moov === undefined) return null
    if (ftyp.start === undefined || moov.start === undefined) return null

    const videoSamples: readonly Sample[] = scan.getTrackSamplesInfo(video.id)
    if (videoSamples.length === 0) return null

    // The last keyframe not after the start, and the first sample at or after the end.
    let first = -1
    for (let i = 0; i < videoSamples.length; i += 1) {
      const sample = videoSamples[i]
      if (sample === undefined) continue
      // No early `break`: samples are in decode order and a B-frame can show later than the
      // keyframe that follows it, so the first sample past the start proves nothing.
      if (sample.is_sync && seconds(sample.cts, sample.timescale) <= startS) first = i
    }
    if (first < 0) first = 0
    // One past the last sample shown before the end, in decode order for the same reason.
    let end = 0
    videoSamples.forEach((sample, i) => {
      if (seconds(sample.cts, sample.timescale) < endS) end = i + 1
    })
    if (end <= first) return null

    const firstSample = videoSamples[first]
    const lastSample = videoSamples[end - 1]
    if (firstSample === undefined || lastSample === undefined) return null
    // The container's own clock starts at the keyframe's decode time: that is what the server
    // measures `-ss` from.
    const originS = seconds(firstSample.dts, firstSample.timescale)

    const ranges: Array<[number, number, number]> = [[video.id, first, end - 1]]
    let low = firstSample.offset
    let high = lastSample.offset + lastSample.size
    if (audio !== undefined) {
      const audioSamples: readonly Sample[] = scan.getTrackSamplesInfo(audio.id)
      const audioFirst = audioSamples.findIndex((s) => seconds(s.cts, s.timescale) >= originS)
      let audioEnd = audioSamples.findIndex(
        (s) => seconds(s.cts, s.timescale) >= endS + AUDIO_SLACK_S,
      )
      if (audioEnd < 0) audioEnd = audioSamples.length
      const a0 = audioSamples[audioFirst]
      const a1 = audioSamples[audioEnd - 1]
      if (audioFirst >= 0 && audioEnd > audioFirst && a0 !== undefined && a1 !== undefined) {
        ranges.push([audio.id, audioFirst, audioEnd - 1])
        low = Math.min(low, a0.offset)
        high = Math.max(high, a1.offset + a1.size)
      }
    }

    // Pass 2: a parser that holds the index and only the bytes the extract needs. The index
    // is fed as if it directly followed the `ftyp` (an index at the end of the file could not
    // be parsed otherwise); sample offsets still refer to the original positions, which is
    // where the media window is placed.
    const cut = createFile(true)
    let initSegment: ArrayBuffer | undefined
    cut.onReady = (parsed) => {
      for (const track of parsed.tracks) cut.setSegmentOptions(track.id, null, { nbSamples: 1 })
      initSegment = cut.initializeSegmentation().buffer
    }
    const ftypEnd = ftyp.start + (ftyp.size ?? 0)
    cut.appendBuffer(MP4BoxBuffer.fromArrayBuffer(await read(ftyp.start, ftypEnd), ftyp.start))
    cut.appendBuffer(
      MP4BoxBuffer.fromArrayBuffer(await read(moov.start, moov.start + moov.size), ftypEnd),
    )
    cut.appendBuffer(MP4BoxBuffer.fromArrayBuffer(await read(low, high), low))
    if (initSegment === undefined) return null

    const parts: BlobPart[] = [initSegment]
    for (const [trackId, from, to] of ranges) {
      const fragment = cut.createFragment(
        trackId,
        from,
        to,
        new DataStream(undefined, 0, Endianness.BIG_ENDIAN),
      )
      // Undefined when a sample's bytes were not in the window: not a cut we can vouch for.
      if (fragment === undefined) return null
      parts.push(fragment.buffer.slice(0, fragment.getPosition()))
    }

    const blob = new Blob(parts, { type: 'video/mp4' })
    const offsetMs = Math.round(originS * 1_000)
    // Relative to the bytes sent, never negative: a start inside the first keyframe's own
    // interval is the start of the extract.
    const relativeStart = Math.max(0, Math.round(startMs - offsetMs))
    const relativeEnd = Math.round(endMs - offsetMs)
    if (relativeEnd <= relativeStart) return null
    return { blob, startMs: relativeStart, endMs: relativeEnd }
  } catch {
    return null
  }
}
