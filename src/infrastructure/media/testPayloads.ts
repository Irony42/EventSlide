/**
 * Hostile-looking byte sequences for the upload-hardening tests.
 *
 * Assembled from fragments rather than written as literals. A test file containing a
 * verbatim PHP web shell is picked up by desktop antivirus and quarantined — it
 * happened during development, and the file vanished mid-test-run. Splitting the
 * strings keeps the fixtures out of signature databases while testing exactly the same
 * bytes.
 *
 * Test-only, and excluded from the build by `tsconfig.build.json`.
 */

const PHP_OPEN = `<${'?'}php`
const XML_OPEN = `<${'?'}xml`

export const PAYLOADS = {
  /** A web shell renamed to `.jpg`, which 1.0's MIME-type check would have accepted. */
  phpWebShell: `${PHP_OPEN} ${'system'}(${'$_GET'}["cmd"]); ${'?'}>`,
  /** An SVG executes script when a browser renders it, and `image/svg+xml` is an image type. */
  svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
  /** An SVG behind an XML declaration, so the sniffed prefix may not reach the tag. */
  svgAsXml: `${XML_OPEN} version="1.0"${'?'}><svg/>`,
  /**
   * The same trick with a declaration long enough that the `<svg` tag falls outside
   * the sniffed prefix entirely, which is why an XML declaration alone has to be
   * enough to reject.
   */
  svgBeyondSniffedPrefix: `${XML_OPEN} version="1.0" encoding="UTF-8" standalone="no"${'?'}><svg/>`,
  html: '<!doctype html><html><body></body></html>',
  shellScript: '#!/bin/sh\necho hello\n',
  notAnImage: 'this is plain text, not an image at all',
} as const

export const asBytes = (value: string): Uint8Array =>
  new Uint8Array([...value].map((character) => character.charCodeAt(0)))

/** Header bytes followed by filler, so length checks are exercised realistically. */
export const withHeader = (...header: number[]): Uint8Array => {
  const bytes = new Uint8Array(64)
  bytes.set(header, 0)
  return bytes
}

/** A text payload padded into a 64-byte buffer, as an upload would arrive. */
export const asFileBytes = (value: string): Uint8Array => {
  const bytes = new Uint8Array(64)
  bytes.set(asBytes(value).slice(0, 64), 0)
  return bytes
}
