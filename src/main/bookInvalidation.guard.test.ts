import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A new way to remove a photograph must not pass unnoticed (spec 04, privacy).
 *
 * The photo book is retired by an explicit call (`invalidateBook`) in each use case that
 * takes a photograph out of the evening. A sixth path added tomorrow, one that deletes a row or
 * moves a status, would leave a book showing a photograph the host or a guest removed, and
 * nothing would fail. This test walks the use cases and says which ones can remove or un-publish a
 * photograph, so that a new one has to either call the hook or be written down here, with the
 * reason it cannot spoil a book. The serving route re-checks every request as a net, but a net
 * is not the plan.
 */

const USE_CASES = join(__dirname, '..', 'application', 'usecases')

/** What marks a use case as one that can remove a photograph or take it off the wall. */
const REMOVES_OR_UNPUBLISHES =
  /\bphotos\.delete\(|\bupdateStatuses\(|\bremovePhotoRecord\(|\.setTakenDown\(|\bphotos\.save\(/

/** Use cases that touch those calls and cannot take a photograph out of a book. Each says why. */
const CANNOT_SPOIL_A_BOOK: Readonly<Record<string, string>> = {
  'clips/transcodeNextClip.ts':
    'it only inserts a clip and publishes it (auto moderation): nothing leaves',
  'photos/uploadPhotos.ts': 'it only inserts photographs and publishes them (auto moderation)',
  'photos/removePhotoRecord.ts':
    'the helper the removing paths call; each of them retires the book first (the guard below counts them)',
  'site/setGuestbookTakedown.ts':
    'it takes down a guestbook message, which a photo book never prints: no photograph changes',
  'site/setEventTakedown.ts':
    'it hides the whole event: the book is served only through the event, so none is reachable and the photographs are unchanged on restoring it',
}

const sourcesUnder = (directory: string): readonly string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return sourcesUnder(path)
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : []
  })

const posix = (path: string): string => relative(USE_CASES, path).split('\\').join('/')

describe('the use cases that can take a photograph out of the evening', () => {
  const touching = sourcesUnder(USE_CASES).filter((path) =>
    REMOVES_OR_UNPUBLISHES.test(readFileSync(path, 'utf8')),
  )

  it('each retires the photo book, or says in writing why it cannot spoil one', () => {
    const unaccounted = touching
      .filter((path) => !readFileSync(path, 'utf8').includes('invalidateBook'))
      .map(posix)
      .filter((name) => CANNOT_SPOIL_A_BOOK[name] === undefined)

    expect(unaccounted).toEqual([])
  })

  it('names the six paths the spec lists, and they all call the hook', () => {
    const hooked = touching
      .filter((path) => readFileSync(path, 'utf8').includes('invalidateBook'))
      .map(posix)
      .sort()

    expect(hooked).toEqual([
      'guests/eraseGuestContribution.ts',
      'moderation/moderatePhoto.ts',
      'moderation/moderatePhotosBulk.ts',
      'photos/deletePhoto.ts',
      'photos/setPhotoCaption.ts',
      'site/setPhotoTakedown.ts',
    ])
  })

  it('keeps no exemption for a file that no longer touches a photograph', () => {
    const stale = Object.keys(CANNOT_SPOIL_A_BOOK).filter(
      (name) => !touching.map(posix).includes(name),
    )

    expect(stale).toEqual([])
  })
})
