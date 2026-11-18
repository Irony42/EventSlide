import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Nothing outside the guest's upload feature may ask for the microphone (spec 25, section 9).
 *
 * `Permissions-Policy: microphone=(self)` is sent on every page a guest can enter by, `/` and
 * `/e/<slug>` included, because a document keeps the policy of the URL it was loaded from
 * (`microphoneOpenOn`, `src/interface/http/middleware/securityHeaders.ts`). The pages that never
 * carry a guest, the host's console, the sign-in, the gallery and the wall, are shut by that
 * header, and this is what keeps the open list from being widened by accident: the code that
 * records lives in `web/src/features/guest-upload/` and nowhere else, so a console or wall module
 * that started to open the microphone fails here, whatever the header says.
 *
 * Read as text, the way `classNames.guard.test.ts` is, because no behaviour tells a call that is
 * allowed from one that is not. The match is case-blind and also catches the prefixed spellings.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ALLOWED = 'web/src/features/guest-upload/'
const REQUEST = /getusermedia/i

const SOURCE = /\.(?:[cm]?[jt]sx?|html)$/
const TEST = /\.(?:test|spec)\.[cm]?[jt]sx?$/

/** The files under `dir` that are source, not tests, not dependencies, not build output. */
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    if (['node_modules', 'dist', 'coverage', '.git'].includes(name)) return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    return SOURCE.test(name) && !TEST.test(name) ? [path] : []
  })

const posix = (path: string): string => relative(ROOT, path).split(sep).join('/')

/** The files, as `[repo-relative path, source]`, that ask for the microphone from where they may not. */
const misplacedMicrophoneRequests = (
  files: readonly (readonly [path: string, source: string])[],
): readonly string[] =>
  files
    .filter(([path, source]) => !path.startsWith(ALLOWED) && REQUEST.test(source))
    .map(([path]) => path)

const GUARD = 'scripts/microphoneGuard.test.ts'

describe('the microphone request', () => {
  it('is made only under web/src/features/guest-upload/', () => {
    const files = ['src', 'web/src', 'web/public', 'scripts', 'tests']
      .flatMap((dir) => {
        try {
          return walk(join(ROOT, dir))
        } catch {
          return []
        }
      })
      .map((path) => [posix(path), readFileSync(path, 'utf8')] as const)
      .filter(([path]) => path !== GUARD)

    expect(files.length).toBeGreaterThan(100)
    expect(misplacedMicrophoneRequests(files)).toEqual([])
  })

  it('finds a request in the console, the wall or the gallery, in any spelling', () => {
    expect(
      misplacedMicrophoneRequests([
        [
          'web/src/features/admin/Recorder.tsx',
          'navigator.mediaDevices.getUserMedia({ audio: true })',
        ],
        ['web/src/features/wall/Ear.ts', 'navigator.mediaDevices.GETUSERMEDIA(x)'],
        ['web/src/lib/legacy.ts', 'navigator.webkitGetUserMedia(x)'],
        [
          'web/src/features/guest-upload/hooks/useVoiceRecorder.ts',
          'navigator.mediaDevices.getUserMedia(x)',
        ],
        ['web/src/features/admin/Quiet.tsx', 'const ok = true'],
      ]),
    ).toEqual([
      'web/src/features/admin/Recorder.tsx',
      'web/src/features/wall/Ear.ts',
      'web/src/lib/legacy.ts',
    ])
  })

  it('does not take a sibling folder for the feature', () => {
    expect(
      misplacedMicrophoneRequests([
        ['web/src/features/guest-upload-extras/x.ts', 'getUserMedia(x)'],
      ]),
    ).toEqual(['web/src/features/guest-upload-extras/x.ts'])
  })
})
