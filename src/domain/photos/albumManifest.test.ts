import { describe, expect, it } from 'vitest'
import { MANIFEST_NAME, renderManifest } from './albumManifest'

const DIGEST = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)

describe('renderManifest', () => {
  it('writes one line per file, digest then two spaces then the name, which is what sha256sum -c reads', () => {
    const text = renderManifest(
      [
        { digest: DIGEST, name: '0001-aaaaaaaaaaaa.jpg' },
        { digest: OTHER, name: 'guestbook.txt' },
      ],
      0,
    )

    expect(text.split('\n').slice(0, 2)).toEqual([
      `${DIGEST}  0001-aaaaaaaaaaaa.jpg`,
      `${OTHER}  guestbook.txt`,
    ])
  })

  it('ends with a comment line that counts the rows whose file was missing, and a newline', () => {
    expect(renderManifest([], 2)).toBe('# missing: 2\n')
    expect(renderManifest([{ digest: DIGEST, name: 'x.jpg' }], 0).endsWith('\n# missing: 0\n')).toBe(
      true,
    )
  })

  it('is named the way the host will look for it', () => {
    expect(MANIFEST_NAME).toBe('MANIFEST.sha256')
  })
})
