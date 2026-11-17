import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * **One door in front of every public reader of photographs** (spec 23, rule 7).
 *
 * On a disposable-camera evening nothing of the guests' photographs may reach the other guests,
 * the room, the podium, the reactions or the shared gallery before the host reveals it. That is
 * one rule asked at each public reader (`visibleStatuses`, `isRevealed`, and the gallery's own
 * `galleryStatuses` which asks the first), and a ninth reader written tomorrow that reads
 * `published` photographs on its own would publish an evening its host meant to hold back, with
 * every test still green. This test walks the use cases the way `routesBoundary.test.ts` walks the
 * routes: a use case that reads photographs by their visibility must either ask the gate or be
 * listed below with the reason it is a host's reader. The second half names the readers that
 * must ask it, so a gate removed from one fails here by name rather than only in its own tests.
 */

const USE_CASES = join(__dirname, '..', 'application', 'usecases')

/**
 * What marks a use case as one that decides which photographs are visible to someone. The
 * predicates of the book and of the best-of (`isInBook`, `isHighlightable`) are left out on
 * purpose: only the host's writers (moderate, delete, caption) ask them, to retire a book or a
 * reel, and the host's own book and reel are served through the event to its members.
 */
const READS_BY_VISIBILITY = /\bisVisibleOnWall\b|\bisInSharedGallery\b|\bisInAlbum\b|'published'/

/** What asks the gate: the domain's rule, and the gallery's wrapper over it. */
const ASKS_THE_GATE = /\b(?:visibleStatuses|galleryStatuses|isRevealed)\(/

/**
 * Use cases that name a visibility and are **not** public readers of photographs. Each says why:
 * a host's reader sees the evening as it arrives (the console is the relecture the mode is for),
 * a writer decides nothing about who may see.
 */
const NOT_PUBLIC_READERS: Readonly<Record<string, string>> = {
  'book/buildNextAlbumBook.ts':
    'the photo book is built for the host from a request only a moderator makes, and served through the event to its owner',
  'clips/transcodeNextClip.ts': 'a writer: it publishes a transcoded clip under auto moderation',
  'photos/uploadPhotos.ts': 'a writer: it publishes an arriving photograph under auto moderation',
  'photos/exportAlbum.ts': 'the host’s own ZIP, behind requireRole("moderator")',
  'guestbook/listGuestbookQueue.ts':
    'the host’s queue of guestbook messages, which are not photographs',
  'highlights/exportHighlights.ts': 'the host’s best-of ZIP, behind requireRole("moderator")',
  'highlights/requestReel.ts': 'the host’s own reel request, behind requireRole("moderator")',
}

/** The public readers, which have to ask the gate. The list is the spec's, confirmed by the code. */
const PUBLIC_READERS: readonly string[] = [
  'slideshow/getWallPlaylist.ts', // the wall, and through it the guests' feed (`/photos` reads the wall)
  'photos/getPhotoMedia.ts', // the media route for a viewer who is no moderator
  'photos/listGuestPhotos.ts', // the guest's own list: it asks `isRevealed` to say `awaitsReveal`
  'reactions/getTopPhotos.ts', // the podium
  'reactions/reactToPhoto.ts', // the reactions
  'gallery/openGallery.ts', // the shared gallery: count
  'gallery/listGalleryPhotos.ts', // the grid and its signed addresses
  'gallery/getGalleryMedia.ts', // the bytes behind a signed address
  'gallery/downloadGalleryArchive.ts', // the whole album as a ZIP
]

const sourcesUnder = (directory: string): readonly string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return sourcesUnder(path)
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : []
  })

const posix = (path: string): string => relative(USE_CASES, path).split('\\').join('/')
/** Code without its comments: a sentence that mentions `visibleStatuses(` must not count as asking the gate. */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
const text = (name: string): string => withoutComments(readFileSync(join(USE_CASES, name), 'utf8'))

describe('the guard reads code, not comments', () => {
  it('does not take a comment for a call to the gate', () => {
    const commented = '/** asks visibleStatuses(reveal, now) */\n// isRevealed(x)\nconst a = 1'
    expect(ASKS_THE_GATE.test(commented)).toBe(true)
    expect(ASKS_THE_GATE.test(withoutComments(commented))).toBe(false)
    expect(ASKS_THE_GATE.test(withoutComments('const s = visibleStatuses(r, now)'))).toBe(true)
  })
})

describe('the use cases that read photographs by their visibility', () => {
  const sources = sourcesUnder(USE_CASES).map(posix)
  const naming = sources.filter((name) => READS_BY_VISIBILITY.test(text(name)))

  it('sees the use cases', () => {
    expect(sources.length).toBeGreaterThan(100)
    expect(naming.length).toBeGreaterThan(8)
  })

  it('each asks the reveal gate, or says in writing why it is not a public reader', () => {
    const unaccounted = naming
      .filter((name) => !ASKS_THE_GATE.test(text(name)))
      .filter((name) => NOT_PUBLIC_READERS[name] === undefined)

    expect(unaccounted).toEqual([])
  })

  it.each(PUBLIC_READERS)('the public reader %s asks the gate', (name) => {
    expect(ASKS_THE_GATE.test(text(name)), `${name} does not ask visibleStatuses`).toBe(true)
  })

  it('keeps no exemption for a file that no longer names a visibility, or that asks the gate', () => {
    const stale = Object.keys(NOT_PUBLIC_READERS).filter(
      (name) => !naming.includes(name) || ASKS_THE_GATE.test(text(name)),
    )

    expect(stale).toEqual([])
  })

  it('names no public reader in two lists', () => {
    expect(PUBLIC_READERS.filter((name) => NOT_PUBLIC_READERS[name] !== undefined)).toEqual([])
  })
})
