import { describe, expect, it } from 'vitest'
import { aWallAnnouncement } from '../../testing/renderWithProviders'
import { announcementLayersAt } from './announcementLayers'

const AT = Date.parse('2026-11-16T21:00:00.000Z')

describe('the announcement layers at one instant of the server clock', () => {
  it('has none without announcements', () => {
    for (const items of [undefined, []]) {
      expect(announcementLayersAt(items, AT)).toEqual({
        band: null,
        card: null,
        pill: null,
        active: false,
        nextChangeMs: null,
      })
    }
  })

  it('shows the banner while counting and the card while showing, never both for one announcement', () => {
    const one = aWallAnnouncement(AT)

    const counting = announcementLayersAt([one], AT - 10_000)
    expect(counting.band).toBe(one)
    expect(counting.card).toBeNull()
    expect(counting.active).toBe(true)

    const showing = announcementLayersAt([one], AT + 1)
    expect(showing.band).toBeNull()
    expect(showing.card).toBe(one)
    expect(showing.active).toBe(true)

    expect(announcementLayersAt([one], AT + 30_000).active).toBe(false)
  })

  it('is not active before the countdown starts', () => {
    expect(announcementLayersAt([aWallAnnouncement(AT)], AT - 300_001).active).toBe(false)
  })

  it('shows the banner of the announcement nearest to its moment when two count down', () => {
    const near = aWallAnnouncement(AT, { id: 'near' })
    const far = aWallAnnouncement(AT + 120_000, { id: 'far' })

    expect(announcementLayersAt([far, near], AT - 10_000).band).toBe(near)
    expect(announcementLayersAt([near, far], AT - 10_000).band).toBe(near)
  })

  it('names the next boundary: the countdown start, then `at`, then the end', () => {
    const one = aWallAnnouncement(AT)

    expect(announcementLayersAt([one], AT - 400_000).nextChangeMs).toBe(AT - 300_000)
    expect(announcementLayersAt([one], AT - 300_000).nextChangeMs).toBe(AT)
    expect(announcementLayersAt([one], AT).nextChangeMs).toBe(AT + 30_000)
    expect(announcementLayersAt([one], AT + 30_000).nextChangeMs).toBeNull()
  })

  it('gives a discreet announcement the pill while it shows, and never the banner or the card', () => {
    const discreet = aWallAnnouncement(AT, {
      kind: 'discreet',
      countdownSeconds: 0,
      durationSeconds: 900,
    })

    expect(announcementLayersAt([discreet], AT - 1).pill).toBeNull()
    const showing = announcementLayersAt([discreet], AT)
    expect(showing.pill).toBe(discreet)
    expect(showing.band).toBeNull()
    expect(showing.card).toBeNull()
    expect(announcementLayersAt([discreet], AT + 899_999).pill).toBe(discreet)
    expect(announcementLayersAt([discreet], AT + 900_000).pill).toBeNull()
  })

  it('does not count a pill as the room’s attention, so it holds nothing (rule 19)', () => {
    const discreet = aWallAnnouncement(AT, {
      kind: 'discreet',
      countdownSeconds: 0,
      durationSeconds: 900,
    })

    expect(announcementLayersAt([discreet], AT + 1).active).toBe(false)
  })

  it('names the start and the end of a discreet announcement as its boundaries', () => {
    const discreet = aWallAnnouncement(AT, {
      kind: 'discreet',
      countdownSeconds: 0,
      durationSeconds: 900,
    })

    expect(announcementLayersAt([discreet], AT - 60_000).nextChangeMs).toBe(AT)
    expect(announcementLayersAt([discreet], AT).nextChangeMs).toBe(AT + 900_000)
    expect(announcementLayersAt([discreet], AT + 900_000).nextChangeMs).toBeNull()
  })

  it('keeps the pill and the card together when a fullscreen card is up over a discreet one', () => {
    const discreet = aWallAnnouncement(AT - 60_000, {
      id: 'pill',
      kind: 'discreet',
      countdownSeconds: 0,
      durationSeconds: 900,
    })
    const full = aWallAnnouncement(AT, { id: 'card', countdownSeconds: 0 })

    const layers = announcementLayersAt([discreet, full], AT + 1)

    expect(layers.pill).toBe(discreet)
    expect(layers.card).toBe(full)
  })
})
