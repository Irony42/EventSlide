import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A new way to take content out of the evening must not pass unnoticed (spec 22, section 7).
 *
 * The verified archive the box keeps is retired by an explicit call (`invalidateExport`) in each use
 * case that removes a photograph, a clip or a message, or reopens the event, **before the bytes
 * go**. A new path added tomorrow, one that deletes a row, moves a status or takes something down,
 * would leave a copy of the album holding what a guest or the host removed, and nothing would
 * fail. This test walks the use cases and says which ones can take content out or reopen the
 * event, so that a new one has to either call the hook or be written down here, with the reason it
 * cannot spoil an archive. The serving route answers only for a `sealed` row, which is a net, not
 * the plan: the file itself must be gone.
 *
 * It is `bookInvalidation.guard.test.ts` with the archive's own list: the archive also holds the
 * hidden photographs and the guestbook, and a reopening voids it.
 */

const USE_CASES = join(__dirname, '..', 'application', 'usecases')

/** What marks a use case as one that can remove content, un-publish it, take it down or reopen. */
const REMOVES_OR_REOPENS = new RegExp(
  [
    String.raw`\bphotos\.delete\(`,
    String.raw`\bupdateStatuses\(`,
    String.raw`\bremovePhotoRecord\(`,
    String.raw`\.setTakenDown\(`,
    String.raw`\bphotos\.save\(`,
    String.raw`\bguestbook\.(?:delete|deleteByGuest|save)\(`,
    String.raw`\bevent\.transitionTo\(`,
    String.raw`\.applySchedule\(`,
  ].join('|'),
)

/** Use cases that touch those calls and cannot take content out of an archive. Each says why. */
const CANNOT_SPOIL_AN_ARCHIVE: Readonly<Record<string, string>> = {
  'clips/transcodeNextClip.ts':
    'it only inserts a clip and publishes it (auto moderation): nothing leaves',
  'photos/uploadPhotos.ts': 'it only inserts photographs and publishes them (auto moderation)',
  'photos/removePhotoRecord.ts':
    'the helper the removing paths call; each of them retires the archive first (the guard below counts them)',
  'photos/setPhotoCaption.ts':
    'a caption is not in the archive (a file, its digest and the guest first names of guestbook.txt only): no content leaves',
  'guestbook/deleteGuestbookEntry.ts':
    'a guest takes back a message only while it is `pending` or `rejected` (`authorMayTakeBack`), and the archive holds published and hidden messages: it cannot remove one it holds',
}

const sourcesUnder = (directory: string): readonly string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return sourcesUnder(path)
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : []
  })

const posix = (path: string): string => relative(USE_CASES, path).split('\\').join('/')

describe('the use cases that can take content out of the evening, or reopen it', () => {
  const touching = sourcesUnder(USE_CASES).filter((path) =>
    REMOVES_OR_REOPENS.test(readFileSync(path, 'utf8')),
  )

  it('each retires the archive, or says in writing why it cannot spoil one', () => {
    const unaccounted = touching
      .filter((path) => !readFileSync(path, 'utf8').includes('invalidateExport'))
      .map(posix)
      .filter((name) => CANNOT_SPOIL_AN_ARCHIVE[name] === undefined)

    expect(unaccounted).toEqual([])
  })

  it('names the paths the spec lists, and they all call the hook', () => {
    const hooked = touching
      .filter((path) => readFileSync(path, 'utf8').includes('invalidateExport'))
      .map(posix)
      .sort()

    expect(hooked).toEqual([
      'events/applyEventSchedules.ts',
      'events/changeEventStatus.ts',
      'guestbook/moderateGuestbookEntry.ts',
      'guests/eraseGuestContribution.ts',
      'moderation/moderatePhoto.ts',
      'moderation/moderatePhotosBulk.ts',
      'photos/deletePhoto.ts',
      'site/setEventTakedown.ts',
      'site/setGuestbookTakedown.ts',
      'site/setPhotoTakedown.ts',
    ])
  })

  it('keeps no exemption for a file that no longer touches what the archive holds', () => {
    const stale = Object.keys(CANNOT_SPOIL_AN_ARCHIVE).filter(
      (name) => !touching.map(posix).includes(name),
    )

    expect(stale).toEqual([])
  })
})
