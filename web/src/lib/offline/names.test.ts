import { describe, expect, it } from 'vitest'
import { CSRF_COOKIE, CSRF_HEADER, KILL_MESSAGE, OUTBOX_DB_NAME, OUTBOX_SYNC_TAG } from './names'

/**
 * The shared names, and the proof that nobody spells them a second time.
 *
 * The first block pins the wire values: a worker already installed on a guest's phone holds the
 * old tag and message, and the server reads the cookie and header, so changing one is a protocol
 * change that should fail here and be done on purpose.
 *
 * The second reads the worker bundle and the page modules as text. `web/sw/` belongs to no
 * vitest project, so this is the only executable link between the worker and the page: a literal
 * copy of a name (the old arrangement) goes red, and so does a worker that stops importing the
 * module.
 */

describe('the wire values', () => {
  it('are the ones installed workers and the server already use', () => {
    expect({
      OUTBOX_SYNC_TAG,
      KILL_MESSAGE,
      CSRF_COOKIE,
      CSRF_HEADER,
      OUTBOX_DB_NAME,
    }).toEqual({
      OUTBOX_SYNC_TAG: 'eventslide-outbox',
      KILL_MESSAGE: 'eventslide:kill',
      CSRF_COOKIE: 'es_csrf',
      CSRF_HEADER: 'x-csrf-token',
      OUTBOX_DB_NAME: 'eventslide-outbox',
    })
  })
})

const sources = import.meta.glob(
  [
    '../../../sw/*.ts',
    './*.ts',
    '../http.ts',
    '../pwa/*.ts',
    '../../features/guest-upload/**/*.ts',
  ],
  { eager: true, query: '?raw', import: 'default' },
) as Readonly<Record<string, string>>

const production = Object.entries(sources).filter(
  ([path]) => !/\.test\.|\/testing\/|\/names\.ts$/.test(path),
)

describe('every other module takes the names from names.ts', () => {
  it('found the worker and the page modules to read', () => {
    // Every check below is vacuously true over an empty glob.
    const paths = production.map(([path]) => path)
    expect(paths).toContain('../../../sw/serviceWorker.ts')
    expect(paths).toContain('./serviceWorker.ts')
    expect(paths).toContain('../http.ts')
    expect(paths).toContain('./fetchSender.ts')
    expect(paths).toContain('./indexedDbOutbox.ts')
  })

  it.each([
    ['the sync tag', OUTBOX_SYNC_TAG],
    ['the kill message', KILL_MESSAGE],
    ['the CSRF cookie', CSRF_COOKIE],
    ['the CSRF header', CSRF_HEADER],
  ])('spells %s nowhere else as a string literal', (_label, value) => {
    const spelled = production
      .filter(([, text]) => new RegExp(`['"]${value}['"]`).test(text))
      .map(([path]) => path)
    expect(spelled).toEqual([])
  })

  it('has the worker import the names it needs', () => {
    const worker = sources['../../../sw/serviceWorker.ts'] ?? ''
    expect(worker).toMatch(
      /import \{[^}]*\bOUTBOX_SYNC_TAG\b[^}]*\} from '..\/src\/lib\/offline\/names'/,
    )
    expect(worker).toMatch(
      /import \{[^}]*\bKILL_MESSAGE\b[^}]*\} from '..\/src\/lib\/offline\/names'/,
    )
    expect(worker).toMatch(
      /import \{[^}]*\bCSRF_COOKIE\b[^}]*\} from '..\/src\/lib\/offline\/names'/,
    )
  })
})
