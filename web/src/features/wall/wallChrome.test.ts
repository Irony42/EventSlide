import { describe, expect, it } from 'vitest'
import type { WallChallengeDto, WallResponse } from '../../lib/api/dto'
import { DEFAULT_JOIN_CARD, chromeOf, type WallChromeInput } from './wallChrome'

const URL_SHORT = 'https://e.fr/j/AB'

const wallOf = (overrides: Partial<WallResponse> = {}): WallResponse => ({
  event: { slug: 'noce', name: 'Noce' },
  joinCode: 'H7K2QM',
  joinUrl: URL_SHORT,
  revision: 'r1',
  items: [],
  slideIntervalMs: 8000,
  kenBurnsDurationMs: 8000,
  layout: 'spotlight',
  reactionsEnabled: false,
  ...overrides,
})

const challenge = (overrides: Partial<WallChallengeDto> = {}): WallChallengeDto => ({
  id: 'c1',
  prompt: 'un selfie',
  startedAt: '2026-06-20T21:00:00.000Z',
  endsAt: '2026-06-20T21:02:00.000Z',
  state: 'running',
  answers: null,
  ...overrides,
})

const chrome = (overrides: Partial<WallChromeInput> = {}) =>
  chromeOf({ wall: wallOf(), itemCount: 3, qrHidden: false, challengeGone: null, ...overrides })

describe('chromeOf: the invitation', () => {
  it('has none before the first read', () => {
    const c = chrome({ wall: null })

    expect(c.join).toBeNull()
    expect(c.invitation).toBeNull()
    expect(c.cardEnabled).toBe(false)
    expect(c.showsOverlay).toBe(false)
    expect(c.chrome).toBe('')
  })

  it('has none when the server sends only half of it', () => {
    const { joinUrl: _link, ...noLink } = wallOf()
    const { joinCode: _code, ...noCode } = wallOf()

    expect(chrome({ wall: noLink }).join).toBeNull()
    expect(chrome({ wall: noCode }).join).toBeNull()
  })

  it('is the code and the link together', () => {
    expect(chrome().invitation).toEqual({ code: 'H7K2QM', url: URL_SHORT })
  })

  it('is withdrawn when the host has closed the evening, but the join stays known', () => {
    const c = chrome({ wall: wallOf({ acceptsGuests: false }) })

    expect(c.acceptsGuests).toBe(false)
    expect(c.invitation).toBeNull()
    expect(c.join).not.toBeNull()
    expect(c.cardEnabled).toBe(false)
  })

  it('assumes guests are accepted when an older server says nothing', () => {
    expect(chrome({ wall: wallOf() }).acceptsGuests).toBe(true)
  })
})

describe('chromeOf: the join card', () => {
  it('is enabled and drawn on a populated wall', () => {
    const c = chrome()

    expect(c.cardEnabled).toBe(true)
    expect(c.showsOverlay).toBe(true)
    expect(c.chrome).toBe('corner')
    expect(c.placement).toBe(DEFAULT_JOIN_CARD.placement)
  })

  it('waits for a first photograph: the empty wall has its own large invitation', () => {
    const c = chrome({ itemCount: 0 })

    expect(c.cardEnabled).toBe(false)
    expect(c.showsOverlay).toBe(false)
  })

  it('is off for good when the host switched it off', () => {
    const c = chrome({
      wall: wallOf({ joinCard: { visible: false, scale: 1, placement: 'bottom-end' } }),
    })

    expect(c.cardEnabled).toBe(false)
    expect(c.showsOverlay).toBe(false)
  })

  it('is put away by Q, and `cardEnabled` still says it exists', () => {
    const c = chrome({ qrHidden: true })

    expect(c.cardEnabled).toBe(true)
    expect(c.showsOverlay).toBe(false)
    expect(c.chrome).toBe('')
  })

  it('is held on screen by a running challenge whatever Q said', () => {
    const c = chrome({ qrHidden: true, wall: wallOf({ challenge: challenge() }) })

    expect(c.showsOverlay).toBe(true)
    expect(c.chrome).toBe('corner top')
  })

  it('is not held by an ended challenge', () => {
    const c = chrome({
      qrHidden: true,
      wall: wallOf({ challenge: challenge({ state: 'ended' }) }),
    })

    expect(c.showsOverlay).toBe(false)
    expect(c.chrome).toBe('top')
  })

  it.each([
    ['top-start', true, false],
    ['top-end', false, true],
    ['bottom-start', false, false],
    ['bottom-end', false, false],
  ] as const)('stacks %s: start %s, end %s', (placement, stackStart, stackEnd) => {
    const c = chrome({ wall: wallOf({ joinCard: { visible: true, scale: 1, placement } }) })

    expect(c.placement).toBe(placement)
    expect(c.stackStart).toBe(stackStart)
    expect(c.stackEnd).toBe(stackEnd)
  })

  it('does not stack a card that is not enabled', () => {
    const c = chrome({
      itemCount: 0,
      wall: wallOf({ joinCard: { visible: true, scale: 1, placement: 'top-end' } }),
    })

    expect(c.stackEnd).toBe(false)
  })

  it('draws the host scale, lifted to the readability floor of a long link', () => {
    const long = `https://example.org/${'x'.repeat(80)}`
    const small = { visible: true, scale: 0.8, placement: 'bottom-end' } as const

    expect(chrome({ wall: wallOf({ joinCard: small }) }).cardScale).toBe(0.8)
    expect(chrome({ wall: wallOf({ joinCard: small, joinUrl: long }) }).cardScale).toBeGreaterThan(
      0.8,
    )
  })

  it('draws at scale 1 with no invitation', () => {
    expect(chrome({ wall: null }).cardScale).toBe(1)
  })
})

describe('chromeOf: the challenge banner', () => {
  it('shows a running challenge, and names it as started', () => {
    const c = chrome({ wall: wallOf({ challenge: challenge() }) })

    expect(c.showsChallenge).toBe(true)
    expect(c.challengeRunning).toBe(true)
    expect(c.shownChallenge?.id).toBe('c1')
    expect(c.startedChallengeId).toBe('c1')
  })

  it('keeps an ended challenge up until its banner has left, and does not call it started', () => {
    const c = chrome({ wall: wallOf({ challenge: challenge({ state: 'ended' }) }) })

    expect(c.showsChallenge).toBe(true)
    expect(c.challengeRunning).toBe(false)
    expect(c.startedChallengeId).toBeNull()
  })

  it('gives the room back once the banner has shown its end', () => {
    const c = chrome({
      wall: wallOf({ challenge: challenge({ state: 'ended' }) }),
      challengeGone: 'c1',
    })

    expect(c.showsChallenge).toBe(false)
    expect(c.shownChallenge).toBeNull()
    expect(c.chrome).toBe('corner')
  })

  it('shows another challenge than the one that is gone', () => {
    const c = chrome({ wall: wallOf({ challenge: challenge({ id: 'c2' }) }), challengeGone: 'c1' })

    expect(c.showsChallenge).toBe(true)
  })

  it('is withheld when the room can no longer send photographs', () => {
    const c = chrome({ wall: wallOf({ acceptsGuests: false, challenge: challenge() }) })

    expect(c.showsChallenge).toBe(false)
    expect(c.startedChallengeId).toBeNull()
  })

  it('shows on the empty wall too', () => {
    const c = chrome({ itemCount: 0, wall: wallOf({ challenge: challenge() }) })

    expect(c.showsChallenge).toBe(true)
    expect(c.chrome).toBe('top')
  })
})
