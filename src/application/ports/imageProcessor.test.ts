import { describe, expect, it } from 'vitest'
import { SUPPORTED_INPUT_FORMATS } from './imageProcessor'

/**
 * The port is types and one runtime value: `SUPPORTED_INPUT_FORMATS`, the allow-list
 * that `ImageFormat` is derived from. It is the declared ingest surface — the set of
 * things a guest may send that the pipeline promises to decode, rotate, strip and
 * re-encode — and the magic-byte gate in `src/infrastructure/media/` is written to
 * detect exactly these and refuse everything else.
 *
 * That makes the list worth pinning. Adding a member here silently widens what the
 * upload endpoint claims to accept, and the cost of getting it wrong is not a broken
 * upload: an entry for a format that carries markup makes a stored "photo" a script
 * the projector will render.
 */
describe('SUPPORTED_INPUT_FORMATS', () => {
  it('names exactly the six formats the ingest pipeline promises to decode', () => {
    expect([...SUPPORTED_INPUT_FORMATS]).toEqual(['jpeg', 'png', 'webp', 'avif', 'heif', 'gif'])
  })

  it.each(['svg', 'xml', 'html'])(
    'admits no markup-bearing format such as %s, which a projector would render as a document',
    (format) => {
      expect([...SUPPORTED_INPUT_FORMATS]).not.toContain(format)
    },
  )
})
