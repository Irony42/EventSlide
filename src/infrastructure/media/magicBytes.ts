import type { ImageFormat } from '../../application/ports/imageProcessor'
import type { VoiceContainer } from '../../application/ports/audioTranscoder'
import type { ClipContainer } from '../../application/ports/videoTranscoder'

/**
 * Identifies an upload by what its bytes actually are.
 *
 * 1.0 decided with `file.mimetype.startsWith('image/')`, which is a string the client
 * chooses. `curl -F 'photos=@shell.php;type=image/jpeg'` passed that check, and the
 * file was then written to disk under a name derived from the client's own filename.
 *
 * Written by hand rather than pulled from a dependency: it is forty lines, the format
 * list is exactly the six we accept, and a security control worth reading is worth
 * owning. Deliberately an allow-list — an unrecognised signature is rejected, never
 * "probably fine".
 *
 * This is the *first* gate. `sharp` still probes and re-encodes afterwards, so a file
 * carrying a valid JPEG header and a payload after it produces output containing only
 * the decoded pixels.
 */

/** Longest prefix any check below needs. */
export const MAGIC_BYTES_PREFIX_LENGTH = 32

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean => {
  if (bytes.length < offset + signature.length) return false
  return signature.every((byte, index) => bytes[offset + index] === byte)
}

const asciiAt = (bytes: Uint8Array, offset: number, length: number): string => {
  if (bytes.length < offset + length) return ''
  let out = ''
  for (let index = offset; index < offset + length; index += 1) {
    out += String.fromCharCode(bytes[index] ?? 0)
  }
  return out
}

/**
 * ISO base media format brands, read from the `ftyp` box at offset 4.
 *
 * These are what a modern iPhone and a modern Android actually produce, so getting
 * them wrong means rejecting most guests' photos.
 */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'])
const AVIF_BRANDS = new Set(['avif', 'avis'])

/**
 * A UTF-8 byte-order mark is the three bytes EF BB BF. `asciiAt` maps each byte to one
 * code unit, so that is what arrives here — not U+FEFF. Built from the code points
 * rather than written as a literal, because an invisible character in source is
 * unreviewable.
 */
const BYTE_ORDER_MARK = new RegExp(`^${String.fromCharCode(0xef, 0xbb, 0xbf)}`)

export const detectImageFormat = (bytes: Uint8Array): ImageFormat | null => {
  // JPEG: SOI marker. The third byte is the start of the first segment marker and is
  // always 0xFF in a real JPEG.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'

  // PNG: signature includes CRLF and EOF bytes specifically so that a corrupting
  // text-mode transfer is detectable.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'

  // GIF87a / GIF89a.
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif'

  // WebP is a RIFF container: 'RIFF' <4-byte size> 'WEBP'. The size field is skipped,
  // so both checks are needed — 'RIFF' alone is also WAV and AVI.
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && asciiAt(bytes, 8, 4) === 'WEBP') {
    return 'webp'
  }

  // HEIC / AVIF: 'ftyp' at offset 4, then a four-character brand.
  if (asciiAt(bytes, 4, 4) === 'ftyp') {
    const brand = asciiAt(bytes, 8, 4).toLowerCase()
    if (AVIF_BRANDS.has(brand)) return 'avif'
    if (HEIF_BRANDS.has(brand)) return 'heif'
  }

  return null
}

/**
 * ISO base media brands that mean **video**, read from the same `ftyp` box at offset 4.
 *
 * The overlap with the image brands above is the whole difficulty: HEIC, AVIF, MP4, MOV
 * and 3GP are all the same container format, distinguished only by a four-character
 * brand. The two sets must stay disjoint, or a guest's iPhone photo is queued for a
 * transcode and a clip is handed to `sharp`.
 *
 * `qt  ` carries a trailing space and that is not a typo: QuickTime's brand is padded to
 * four characters, and an iPhone recording `.MOV` writes exactly that.
 */
const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'mp4v',
  'm4v ',
  'dash',
  // QuickTime, which is what a `.MOV` straight off an iPhone is.
  'qt  ',
  // 3GPP / 3GPP2, still what a cheap Android handset records.
  '3gp4',
  '3gp5',
  '3gp6',
  '3g2a',
])

/**
 * Which container these bytes are, from the signature alone.
 *
 * The cheap gate on the upload path: no subprocess, no decode, a handful of bytes read.
 * It is deliberately **not** `detectImageFormat` with more rows — the two answer
 * different questions and feed different pipelines, and folding them together is how a
 * clip would end up at `sharp(...)`.
 *
 * Note where `ftyp` lives: **offset 4**, not 0. Everything else in this module matches at
 * offset zero, which is why the ISO base media checks are the only ones here that take an
 * offset at all.
 */
export const detectVideoContainer = (bytes: Uint8Array): ClipContainer | null => {
  // Matroska and WebM share the EBML header; the doctype that separates them sits
  // further in, and both are one demuxer to ffmpeg, so there is nothing to tell apart.
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'matroska'

  if (asciiAt(bytes, 4, 4) === 'ftyp') {
    const brand = asciiAt(bytes, 8, 4).toLowerCase()
    if (MP4_BRANDS.has(brand)) return 'mp4'
  }

  return null
}

/**
 * The brands of an MP4 that may hold a **voice message** (spec 25): every video brand above, which
 * an iPhone's `MediaRecorder` may write for an `audio/mp4`, **plus** `M4A ` and `M4B `, the
 * audio-only ones. The trailing space is not a typo: `asciiAt` is read through a `toLowerCase`,
 * so these are `m4a ` and `m4b `, padded to four characters like `qt  `.
 *
 * Exported so a test can hold this set **disjoint from the image brands** (HEIC and AVIF are the
 * same container format, and a guest's photograph must never be queued as a recording).
 */
export const AUDIO_MP4_BRANDS: ReadonlySet<string> = new Set([...MP4_BRANDS, 'm4a ', 'm4b '])

/** The image brands, exported for the same disjointness test. */
export const IMAGE_BRANDS: ReadonlySet<string> = new Set([...HEIF_BRANDS, ...AVIF_BRANDS])

/**
 * Which container these bytes are for a **voice message**, from the signature alone: the twin of
 * {@link detectVideoContainer}, **not a row of it** (spec 25). They answer different questions and
 * feed different pipelines, which is the argument this file makes for images and video. It starts
 * no process and reads a handful of bytes, so a renamed PDF is refused before a byte is written.
 *
 * Three containers: Matroska (`1A 45 DF A3`, which covers WebM, what Chrome and Edge record),
 * MP4 (`ftyp` at **offset 4**, an audio-capable brand, what Safari records) and Ogg (`OggS`, what
 * desktop Firefox records). An unrecognised signature is refused, never "probably fine".
 */
export const detectAudioContainer = (bytes: Uint8Array): VoiceContainer | null => {
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'matroska'

  // 'OggS'
  if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return 'ogg'

  if (asciiAt(bytes, 4, 4) === 'ftyp') {
    const brand = asciiAt(bytes, 8, 4).toLowerCase()
    if (AUDIO_MP4_BRANDS.has(brand)) return 'mp4'
  }

  return null
}

/**
 * Signatures worth naming in a log line when an upload is rejected.
 *
 * The point is not extra safety — anything not in the allow-list above is already
 * refused. It is that "a guest's browser sent an SVG" and "someone posted a PHP file
 * to the upload endpoint" call for different responses from an operator, and an
 * `image.unsupportedFormat` with no detail cannot tell them apart.
 */
export type SuspiciousKind =
  | 'svg'
  | 'html'
  | 'php'
  | 'script'
  | 'zip'
  | 'pdf'
  | 'elf'
  | 'windows-executable'

export const identifySuspicious = (bytes: Uint8Array): SuspiciousKind | null => {
  if (startsWith(bytes, [0x4d, 0x5a])) return 'windows-executable' // 'MZ'
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return 'elf'
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'zip' // also docx, jar, apk
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'pdf' // '%PDF'

  // Text formats can carry a BOM and leading whitespace, so sniff a normalised prefix
  // rather than matching at offset zero.
  const head = asciiAt(bytes, 0, MAGIC_BYTES_PREFIX_LENGTH)
    .replace(BYTE_ORDER_MARK, '')
    .trimStart()
    .toLowerCase()

  if (head.startsWith('<?php')) return 'php'
  if (head.startsWith('#!')) return 'script'
  if (head.includes('<svg')) return 'svg'
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'html'
  // An SVG served as XML: '<?xml ... <svg'. The prefix may not reach the svg tag, so
  // an XML declaration alone is enough to reject and worth naming as such.
  if (head.startsWith('<?xml')) return 'svg'

  return null
}
