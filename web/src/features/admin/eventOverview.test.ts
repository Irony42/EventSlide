import { describe, expect, it } from 'vitest'
import { nowTiles, overviewTiles, type EventPageFacts } from './eventOverview'

const facts = (overrides: Partial<EventPageFacts> = {}): EventPageFacts => ({
  status: 'live',
  role: 'owner',
  allowGuestbook: false,
  ...overrides,
})

describe('the "Maintenant" card', () => {
  it('holds the queue and the screen during the evening', () => {
    expect(nowTiles(facts({ status: 'live' }))).toEqual(['moderate', 'wall'])
  })

  it('holds the album, to download and to share, once the evening is over', () => {
    expect(nowTiles(facts({ status: 'closed' }))).toEqual(['download', 'share'])
  })

  it('holds only the download for a moderator after the evening: sharing is the owner’s', () => {
    expect(nowTiles(facts({ status: 'closed', role: 'moderator' }))).toEqual(['download'])
  })

  it('holds the download of an archived event, the one thing left to do with it', () => {
    expect(nowTiles(facts({ status: 'archived' }))).toEqual(['download'])
  })

  it('holds no tile before the evening, where it is a list of things to get ready', () => {
    expect(nowTiles(facts({ status: 'draft' }))).toEqual([])
  })
})

describe('the overview', () => {
  it.each(['draft', 'live', 'closed', 'archived'] as const)(
    'never repeats what the "Maintenant" card holds (%s)',
    (status) => {
      const now = nowTiles(facts({ status }))
      expect(overviewTiles(facts({ status })).filter((d) => now.includes(d))).toEqual([])
    },
  )

  it('lists everything else an owner has during the evening, the evening’s tools first', () => {
    expect(overviewTiles(facts({ allowGuestbook: true }))).toEqual([
      'guestbook',
      'challenge',
      'missions',
      'guests',
      'moderators',
      'bestOf',
      'book',
      'share',
      'stats',
      'settings',
      'download',
    ])
  })

  it('keeps the queue and the screen reachable once the evening is over, below the album', () => {
    const after = overviewTiles(facts({ status: 'closed' }))
    expect(after.slice(0, 2)).toEqual(['moderate', 'wall'])
  })

  it('offers no queue and no screen on an archived event', () => {
    const archived = overviewTiles(facts({ status: 'archived' }))
    expect(archived).not.toContain('moderate')
    expect(archived).not.toContain('wall')
  })

  it('gives a moderator nothing that is the owner’s', () => {
    const moderator = overviewTiles(facts({ role: 'moderator' }))
    for (const ownerOnly of ['missions', 'moderators', 'share', 'settings'] as const) {
      expect(moderator).not.toContain(ownerOnly)
    }
  })

  it('lists the guestbook only on an event that has one', () => {
    expect(overviewTiles(facts({ allowGuestbook: false }))).not.toContain('guestbook')
    expect(overviewTiles(facts({ allowGuestbook: true }))).toContain('guestbook')
  })
})
