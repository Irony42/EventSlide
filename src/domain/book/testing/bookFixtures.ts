import { asGuestId, asPhotoId, type GuestbookEntryId, type GuestId } from '../../shared/ids'
import type { BookCounts, BookMessage, BookPhoto } from '../bookInput'
import type { BookOptionsV2 } from '../bookOptionsV2'

/** 2026-06-13 18:00 UTC: a Saturday evening, 20:00 in Paris. */
export const T0 = Date.UTC(2026, 5, 13, 18, 0, 0)
export const MINUTE = 60_000

export const guest = (n: number): GuestId => asGuestId(`g${String(n).padStart(3, '0')}`)

let counter = 0

export const makePhoto = (over: Partial<BookPhoto> & { minute?: number } = {}): BookPhoto => {
  counter += 1
  const { minute, ...rest } = over
  return {
    id: asPhotoId(`p${String(counter).padStart(5, '0')}`),
    createdAt: new Date(T0 + (minute ?? counter) * MINUTE),
    width: 1500,
    height: 1000,
    guestId: guest(1),
    reactions: 0,
    highlighted: false,
    missionId: null,
    challengeId: null,
    hasCaption: false,
    ...rest,
  }
}

export const makeMessage = (
  over: Partial<BookMessage> & { minute?: number; n?: number } = {},
): BookMessage => {
  counter += 1
  const { minute, n, ...rest } = over
  return {
    id: `m${String(n ?? counter).padStart(5, '0')}` as GuestbookEntryId,
    guestId: guest(1),
    createdAt: new Date(T0 + (minute ?? counter) * MINUTE),
    length: 100,
    ...rest,
  }
}

export const COUNTS: BookCounts = {
  photos: 0,
  photographers: 0,
  hearts: 0,
  messages: 0,
  voices: 0,
  videos: 0,
}

export const OPTIONS: BookOptionsV2 = {
  title: 'Soirée',
  subtitle: '',
  language: 'fr',
  style: 'classique',
  selection: { kind: 'all' },
  showAuthors: true,
  showCaptions: true,
  includeGuestbook: false,
  printVersion: false,
  timeZone: 'Europe/Paris',
}

/** A small seeded generator (mulberry32): the property tests need replayable albums, not `fast-check`. */
export const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SIZES: readonly (readonly [number, number])[] = [
  [1500, 1000],
  [1000, 1500],
  [1600, 900],
  [1200, 1600],
  [1000, 1000],
  [1920, 1080],
  [900, 1600],
]

/** A random album: moments separated by long silences, bursts, hearts, stars, captions, messages. */
export const generateAlbum = (seed: number): { photos: BookPhoto[]; messages: BookMessage[] } => {
  const random = seeded(seed)
  const int = (max: number): number => Math.floor(random() * max)
  const photos: BookPhoto[] = []
  const moments = 1 + int(5)
  let clock = 0
  const guests = 1 + int(12)
  for (let m = 0; m < moments; m += 1) {
    clock += m === 0 ? 0 : (30 + int(400)) * MINUTE
    const count = int(70)
    for (let i = 0; i < count; i += 1) {
      clock += int(12 * MINUTE)
      const [width, height] = SIZES[int(SIZES.length)]!
      const who = guest(int(guests))
      const burst = random() < 0.12 ? 1 + int(8) : 1
      for (let b = 0; b < burst; b += 1) {
        clock += int(15_000)
        photos.push({
          id: asPhotoId(`s${seed}-${photos.length}`),
          // Photographs may share an instant on purpose: ties must not matter.
          createdAt: new Date(T0 + clock),
          width: b === 0 || random() < 0.8 ? width : height,
          height: b === 0 || random() < 0.8 ? height : width,
          guestId: random() < 0.05 ? null : who,
          reactions: random() < 0.3 ? int(9) : 0,
          highlighted: random() < 0.04,
          missionId: null,
          challengeId: null,
          hasCaption: random() < 0.4,
        })
      }
    }
  }
  const messages: BookMessage[] = []
  const written = int(90)
  for (let i = 0; i < written; i += 1) {
    messages.push({
      id: `s${seed}-m${i}` as GuestbookEntryId,
      guestId: guest(int(guests)),
      createdAt: new Date(T0 + int(clock + 1)),
      length: 1 + int(500),
    })
  }
  return { photos, messages }
}
