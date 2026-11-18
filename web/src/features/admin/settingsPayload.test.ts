import { describe, expect, it } from 'vitest'
import { eventSettings } from '../../testing/renderWithProviders'
import { toSettingsPatch, voiceChanges } from './settingsPayload'

describe('toSettingsPatch', () => {
  it('leaves the photograph’s URL out of the theme, which the server’s strict schema would refuse', () => {
    const draft = eventSettings({
      theme: {
        accentHue: 345,
        fonts: 'serif',
        frame: 'round',
        ambiance: 'eventslide',
        groundUrl: `/api/events/camille-et-sacha/venue-photo/${'ab'.repeat(32)}`,
      },
    })

    expect(toSettingsPatch(draft).theme).toEqual({
      accentHue: 345,
      fonts: 'serif',
      frame: 'round',
      ambiance: 'eventslide',
    })
    expect(toSettingsPatch(draft).theme).not.toHaveProperty('groundUrl')
  })

  it('keeps every other setting as the host left it', () => {
    const draft = eventSettings({ moderation: 'auto', retentionDays: 30 })

    expect(toSettingsPatch(draft)).toMatchObject({ moderation: 'auto', retentionDays: 30 })
  })

  describe('the reveal group (spec 23)', () => {
    const LOADED = eventSettings({
      reveal: { enabled: true, at: '2026-06-20T21:00:00.000Z', film: false },
    })

    it('sends only the keys the host changed, so a save that names the film cannot forget the hour', () => {
      const draft = eventSettings({
        reveal: { enabled: true, at: '2026-06-20T21:00:00.000Z', film: true },
      })

      expect(toSettingsPatch(draft, LOADED).reveal).toEqual({ film: true })
    })

    it('sends no group at all when nothing in it changed', () => {
      expect(toSettingsPatch(LOADED, LOADED)).not.toHaveProperty('reveal')
    })

    it('sends a cleared hour as null, which is the button', () => {
      const draft = eventSettings({ reveal: { enabled: true, at: null, film: false } })

      expect(toSettingsPatch(draft, LOADED).reveal).toEqual({ at: null })
    })

    it('never sends the group from a caller that did not load it (the ambiance page)', () => {
      // That page sends what it holds; a whole group would put its stale hour back after a reveal.
      expect(toSettingsPatch(LOADED)).not.toHaveProperty('reveal')
    })

    it('sends nothing for a server that predates the group', () => {
      const { reveal: _reveal, ...older } = LOADED

      expect(toSettingsPatch(older, older)).not.toHaveProperty('reveal')
    })
  })

  describe('the voice group (spec 25)', () => {
    const loaded = eventSettings({
      guestbookVoice: { enabled: true, sealed: true, opensAtMs: 5_000 },
    })

    it('sends only the keys the form changed, so a stale opening time is never written back', () => {
      const draft = { ...loaded, guestbookVoice: { ...loaded.guestbookVoice, sealed: false } }

      expect(toSettingsPatch(draft, loaded).guestbookVoice).toEqual({ sealed: false })
    })

    it('sends no group at all when nothing of it changed', () => {
      expect(toSettingsPatch(loaded, loaded)).not.toHaveProperty('guestbookVoice')
    })

    it('sends no group from a screen that never loaded it (the ambiance page)', () => {
      expect(toSettingsPatch(loaded)).not.toHaveProperty('guestbookVoice')
    })

    it('names a changed opening time and a changed switch together', () => {
      expect(
        voiceChanges({ enabled: false, sealed: true, opensAtMs: null }, loaded.guestbookVoice),
      ).toEqual({ enabled: false, opensAtMs: null })
    })
  })
})
