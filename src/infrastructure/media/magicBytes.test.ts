import { describe, expect, it } from 'vitest'
import { detectImageFormat, detectVideoContainer, identifySuspicious } from './magicBytes'
import { PAYLOADS, asBytes, withHeader } from './testPayloads'

const ascii = (text: string): number[] => [...asBytes(text)]

const isoContainer = (brand: string): Uint8Array => {
  const bytes = new Uint8Array(64)
  bytes.set([0x00, 0x00, 0x00, 0x20], 0) // box size
  bytes.set(ascii('ftyp'), 4)
  bytes.set(ascii(brand), 8)
  return bytes
}

const textFile = (text: string): Uint8Array => {
  const bytes = new Uint8Array(64)
  bytes.set(ascii(text).slice(0, 64), 0)
  return bytes
}

describe('detectImageFormat', () => {
  it('recognises a JPEG by its start-of-image marker', () => {
    expect(detectImageFormat(withHeader(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg')
  })

  it('recognises a PNG by its full eight-byte signature', () => {
    expect(
      detectImageFormat(withHeader(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBe('png')
  })

  it('rejects a PNG signature truncated after the first four bytes', () => {
    expect(detectImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
  })

  it.each([
    ['GIF87a', 0x37],
    ['GIF89a', 0x39],
  ])('recognises %s', (_label, versionByte) => {
    expect(
      detectImageFormat(withHeader(0x47, 0x49, 0x46, 0x38, versionByte, 0x61)),
    ).toBe('gif')
  })

  it('recognises a WebP by both the RIFF container and the WEBP form type', () => {
    const bytes = new Uint8Array(64)
    bytes.set(ascii('RIFF'), 0)
    bytes.set([0x24, 0x00, 0x00, 0x00], 4)
    bytes.set(ascii('WEBP'), 8)
    expect(detectImageFormat(bytes)).toBe('webp')
  })

  it('rejects a RIFF container that is a WAV, not a WebP', () => {
    const bytes = new Uint8Array(64)
    bytes.set(ascii('RIFF'), 0)
    bytes.set(ascii('WAVE'), 8)
    expect(detectImageFormat(bytes)).toBeNull()
  })

  it.each(['heic', 'heix', 'mif1', 'msf1', 'hevc', 'heim'])(
    'recognises the HEIF brand %s, which is what an iPhone actually uploads',
    (brand) => {
      expect(detectImageFormat(isoContainer(brand))).toBe('heif')
    },
  )

  it.each(['avif', 'avis'])('recognises the AVIF brand %s', (brand) => {
    expect(detectImageFormat(isoContainer(brand))).toBe('avif')
  })

  it('accepts an uppercase ISO brand, since the field is not case-normalised on device', () => {
    expect(detectImageFormat(isoContainer('HEIC'))).toBe('heif')
  })

  it('rejects an ISO container whose brand is not an image', () => {
    // 'mp42' is a video. Accepting it would hand sharp a file it cannot decode.
    expect(detectImageFormat(isoContainer('mp42'))).toBeNull()
  })

  it('rejects an empty buffer', () => {
    expect(detectImageFormat(new Uint8Array(0))).toBeNull()
  })

  it('rejects a buffer shorter than any signature', () => {
    expect(detectImageFormat(new Uint8Array([0xff]))).toBeNull()
  })

  it('rejects an SVG, whatever the client claimed the MIME type was', () => {
    // The 1.0 check was `file.mimetype.startsWith('image/')`, and image/svg+xml
    // passes it. An SVG rendered by a browser executes script.
    expect(detectImageFormat(textFile(PAYLOADS.svg))).toBeNull()
  })

  it('rejects a PHP file renamed to .jpg', () => {
    expect(detectImageFormat(textFile(PAYLOADS.phpWebShell))).toBeNull()
  })

  it('rejects a ZIP, which a polyglot upload would use as its container', () => {
    expect(detectImageFormat(withHeader(0x50, 0x4b, 0x03, 0x04))).toBeNull()
  })
})

describe('identifySuspicious', () => {
  it.each([
    ['php', PAYLOADS.phpWebShell],
    ['script', PAYLOADS.shellScript],
    ['svg', PAYLOADS.svg],
    ['html', PAYLOADS.html],
    ['svg', PAYLOADS.svgAsXml],
  ])('names a %s payload so an operator can tell why an upload was refused', (kind, text) => {
    expect(identifySuspicious(textFile(text))).toBe(kind)
  })

  it('names an XML declaration as an SVG even when the tag is past the sniffed prefix', () => {
    // Only the first 32 bytes are sniffed, and an XML declaration carrying an encoding
    // and a standalone attribute fills them on its own. An XML file offered as a photo
    // is refused on the declaration alone rather than waiting to see a tag that will
    // never be read.
    const bytes = textFile(PAYLOADS.svgBeyondSniffedPrefix)
    expect(String.fromCharCode(...bytes.slice(0, 32))).not.toContain('<svg')

    expect(identifySuspicious(bytes)).toBe('svg')
  })

  it('sees through a byte-order mark and leading whitespace', () => {
    const bytes = new Uint8Array(64)
    bytes.set([0xef, 0xbb, 0xbf], 0)
    bytes.set(ascii(`   ${PAYLOADS.phpWebShell}`), 3)
    expect(identifySuspicious(bytes)).toBe('php')
  })

  it.each([
    ['windows-executable', [0x4d, 0x5a, 0x90, 0x00]],
    ['elf', [0x7f, 0x45, 0x4c, 0x46]],
    ['zip', [0x50, 0x4b, 0x03, 0x04]],
    ['pdf', [0x25, 0x50, 0x44, 0x46]],
  ])('names a %s by signature', (kind, header) => {
    expect(identifySuspicious(withHeader(...header))).toBe(kind)
  })

  it('says nothing about a real JPEG', () => {
    expect(identifySuspicious(withHeader(0xff, 0xd8, 0xff, 0xe0))).toBeNull()
  })

  it('says nothing about an empty buffer', () => {
    expect(identifySuspicious(new Uint8Array(0))).toBeNull()
  })
})

// ---------------------------------------------------------------------- video --

/**
 * The video signatures. They share the `ftyp` box with HEIC and AVIF above, which is the
 * whole difficulty: a phone's photo and a phone's clip are the same container format,
 * distinguished only by a four-character brand. The two sets must stay disjoint or a
 * still is queued for a transcode and a clip is handed to `sharp`.
 */
const isoBox = (brand: string): Uint8Array =>
  Uint8Array.from([
    0x00,
    0x00,
    0x00,
    0x18,
    ...[...'ftyp'].map((character) => character.charCodeAt(0)),
    ...[...brand].map((character) => character.charCodeAt(0)),
    0x00,
    0x00,
    0x02,
    0x00,
  ])

describe('detectVideoContainer', () => {
  it.each(['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'qt  ', '3gp4'])(
    'recognises the %s brand as mp4',
    (brand) => {
      expect(detectVideoContainer(isoBox(brand))).toBe('mp4')
    },
  )

  it('recognises a Matroska or WebM header', () => {
    // One EBML header, one demuxer to ffmpeg, so there is nothing to tell apart.
    expect(detectVideoContainer(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]))).toBe(
      'matroska',
    )
  })

  it.each(['heic', 'avif', 'mif1'])('does not treat the %s brand as a video', (brand) => {
    // A phone's photograph. Queueing it for a transcode would refuse it thirty seconds
    // later with a code that means something else entirely.
    expect(detectVideoContainer(isoBox(brand))).toBeNull()
  })

  it('does not treat a JPEG as a video', () => {
    expect(detectVideoContainer(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBeNull()
  })

  it('refuses bytes with no ftyp box at all', () => {
    expect(detectVideoContainer(new TextEncoder().encode('%PDF-1.7 not a clip'))).toBeNull()
  })

  it('refuses a prefix too short to hold a brand', () => {
    expect(detectVideoContainer(Uint8Array.from([0x00, 0x00]))).toBeNull()
  })

  it('does not confuse the two pipelines: no image brand is a video brand', () => {
    for (const brand of ['heic', 'heix', 'avif', 'avis', 'mif1', 'msf1']) {
      expect(detectVideoContainer(isoBox(brand))).toBeNull()
      expect(detectImageFormat(isoBox(brand))).not.toBeNull()
    }
    for (const brand of ['isom', 'mp42', 'qt  ']) {
      expect(detectImageFormat(isoBox(brand))).toBeNull()
      expect(detectVideoContainer(isoBox(brand))).toBe('mp4')
    }
  })
})
