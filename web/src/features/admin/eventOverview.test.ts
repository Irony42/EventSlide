import { describe, expect, it } from 'vitest'
import { nowTiles, type EventPageFacts } from './eventOverview'

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

  it('offers no queue and no screen on an archived event', () => {
    expect(nowTiles(facts({ status: 'archived' }))).not.toContain('moderate')
    expect(nowTiles(facts({ status: 'archived' }))).not.toContain('wall')
  })
})
