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

  it('names the seven paths that retire the book, and they all call the hook', () => {
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
      'site/setGuestbookTakedown.ts',
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

/**
 * The same net for the guest book (spec 26): a book can print guests' words, so a way to delete a
 * message, move it off the wall or take it down must retire the book with `messageRemoved`, or say
 * here why it cannot spoil one.
 */
const REMOVES_A_MESSAGE =
  /\bguestbook\.(delete|save|deleteByGuest|setTakenDown)\(|\.deleteByGuest\(|\bvoices\.deleteByEntry\(/

const MESSAGE_CANNOT_SPOIL_A_BOOK: Readonly<Record<string, string>> = {
  'guestbook/keepPendingGuestbookVoices.ts':
    'it only moves a waiting recording to published (the host keeps it): nothing leaves',
  'guestbook/stageGuestbookVoice.ts': 'it only inserts a recording; nothing leaves',
}

describe('the use cases that can take a guest-book message out of the evening', () => {
  const touching = sourcesUnder(USE_CASES).filter((path) =>
    REMOVES_A_MESSAGE.test(readFileSync(path, 'utf8')),
  )
  const retires = (path: string): boolean =>
    /invalidateBook\??\.?\([^)]*'messageRemoved'/.test(readFileSync(path, 'utf8'))

  it('each retires the photo book for a removed message, or says in writing why it cannot', () => {
    const unaccounted = touching
      .filter((path) => !retires(path))
      .map(posix)
      .filter((name) => MESSAGE_CANNOT_SPOIL_A_BOOK[name] === undefined)

    expect(unaccounted).toEqual([])
  })

  it('names the four paths the spec lists, and they all call the hook', () => {
    expect(touching.filter(retires).map(posix).sort()).toEqual([
      'guestbook/deleteGuestbookEntry.ts',
      'guestbook/moderateGuestbookEntry.ts',
      'guests/eraseGuestContribution.ts',
      'site/setGuestbookTakedown.ts',
    ])
  })

  it('calls the hook twice, before the removal and after it, so a book requested in between is retired too', () => {
    const calls = (path: string): number =>
      readFileSync(path, 'utf8').split("'messageRemoved'").length - 1

    for (const path of touching.filter(retires)) {
      expect(calls(path), posix(path)).toBeGreaterThanOrEqual(2)
    }
  })

  it('keeps no exemption for a file that no longer touches a message, or that retires the book', () => {
    const stale = Object.keys(MESSAGE_CANNOT_SPOIL_A_BOOK).filter(
      (name) => !touching.map(posix).includes(name) || retires(join(USE_CASES, name)),
    )

    expect(stale).toEqual([])
  })
})

/**
 * A reply that holds a note to the guestbook (spec 30, lot 4) takes a guestbook message with it when it is
 * erased, in the repository's one write: so every use case that erases replies must tell what prints the
 * guestbook (`beforeNotesErased` and `afterNotesErased`, which retire the book and the archive and publish
 * `guestbook.changed`). A fourth way to erase replies, added tomorrow, fails here until it does.
 */
describe('the use cases that erase replies, and the notes they take with them', () => {
  const ERASES_REPLIES = /\brsvps\.delete\(|\brsvps\.deleteExpired\(/
  /** Erases only a reply it has just made, which holds no note. */
  const NEVER_HOLDS_A_NOTE: Readonly<Record<string, string>> = {
    'guestRsvps/hostAddRsvp.ts':
      'takes back the reply it has just added when the audit log refuses: nothing could have left a note on it',
  }
  const erasing = sourcesUnder(USE_CASES).filter(
    (path) =>
      ERASES_REPLIES.test(readFileSync(path, 'utf8')) &&
      NEVER_HOLDS_A_NOTE[posix(path)] === undefined,
  )

  it('names the exemption, and it still erases a reply', () => {
    for (const name of Object.keys(NEVER_HOLDS_A_NOTE)) {
      expect(ERASES_REPLIES.test(readFileSync(join(USE_CASES, name), 'utf8')), name).toBe(true)
    }
  })

  it('found the three paths that erase replies', () => {
    expect(erasing.map(posix).sort()).toEqual([
      'guestRsvps/hostDeleteRsvp.ts',
      'guestRsvps/ownRsvp.ts',
      'guestRsvps/purgeExpiredRsvps.ts',
    ])
  })

  it('each tells what prints the guestbook, before and after', () => {
    for (const path of erasing) {
      const source = readFileSync(path, 'utf8')
      expect(source, posix(path)).toContain('beforeNotesErased(')
      expect(source, posix(path)).toContain('afterNotesErased(')
    }
  })
})
