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

  it('leaves a discreet announcement to its own layer', () => {
    const discreet = aWallAnnouncement(AT, { kind: 'discreet', countdownSeconds: 0 })

    expect(announcementLayersAt([discreet], AT + 1)).toEqual({
      band: null,
      card: null,
      active: false,
      nextChangeMs: null,
    })
  })
})
