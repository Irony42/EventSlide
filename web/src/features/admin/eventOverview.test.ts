import { describe, expect, it } from 'vitest'
import { asksForLogo, nowTiles, type EventPageFacts } from './eventOverview'

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

describe('the « Ajouter votre logo » step', () => {
  const LOGO = `/api/events/camille-et-sacha/logo/${'ab'.repeat(32)}`

  it('is asked of the owner while the event has no logo', () => {
    expect(asksForLogo({ role: 'owner', logoUrl: null })).toBe(true)
    expect(asksForLogo({ role: 'owner', logoUrl: undefined })).toBe(true)
  })

  it('leaves the list once the event has a logo', () => {
    expect(asksForLogo({ role: 'owner', logoUrl: LOGO })).toBe(false)
  })

  it('is not asked of a moderator, who cannot send one', () => {
    expect(asksForLogo({ role: 'moderator', logoUrl: null })).toBe(false)
  })

  it('does not count a path the client would not render as a logo', () => {
    expect(asksForLogo({ role: 'owner', logoUrl: 'https://evil.example/logo.png' })).toBe(true)
  })
})
