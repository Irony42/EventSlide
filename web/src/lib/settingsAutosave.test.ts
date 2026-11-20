import { describe, expect, it } from 'vitest'
import { eventSettings } from '../testing/renderWithProviders'
import { applySettingsPatch, mergeSettingsPatch } from './settingsAutosave'

describe('mergeSettingsPatch', () => {
  it('lets the later value of a field win', () => {
    expect(mergeSettingsPatch({ allowCaptions: true }, { allowCaptions: false })).toEqual({
      allowCaptions: false,
    })
  })

  it('keeps both keys of a per-key group named by two quick choices', () => {
    expect(mergeSettingsPatch({ wall: { tilt: true } }, { wall: { freshLane: false } })).toEqual({
      wall: { tilt: true, freshLane: false },
    })
    expect(mergeSettingsPatch({ reveal: { film: true } }, { reveal: { at: null } })).toEqual({
      reveal: { film: true, at: null },
    })
    expect(
      mergeSettingsPatch(
        { guestbookVoice: { enabled: true } },
        { guestbookVoice: { sealed: true } },
      ),
    ).toEqual({ guestbookVoice: { enabled: true, sealed: true } })
  })
})

describe('applySettingsPatch', () => {
  it('shows a pending choice over what the server holds', () => {
    const settings = eventSettings({ allowCaptions: true })

    expect(applySettingsPatch(settings, { allowCaptions: false }).allowCaptions).toBe(false)
  })

  it('keeps the server’s value for the keys of a group the patch does not name', () => {
    const settings = eventSettings()

    const shown = applySettingsPatch(settings, { wall: { tilt: !settings.wall.tilt } })

    expect(shown.wall).toEqual({ ...settings.wall, tilt: !settings.wall.tilt })
  })

  it('keeps the stored photograph of the venue under a pending theme', () => {
    const settings = eventSettings({
      theme: {
        accentHue: 305,
        fonts: 'sans',
        frame: 'soft',
        ambiance: 'eventslide',
        groundUrl: '/api/events/x/venue-photo/ab',
      },
    })

    const shown = applySettingsPatch(settings, {
      theme: { accentHue: 345, fonts: 'sans', frame: 'soft', ambiance: 'eventslide' },
    })

    expect(shown.theme).toEqual({ ...settings.theme, accentHue: 345 })
  })

  it('shows a pending welcome message, and keeps the logo', () => {
    const settings = eventSettings({ brand: { welcomeMessage: null, logoUrl: '/logo' } })

    expect(applySettingsPatch(settings, { welcomeMessage: 'Bienvenue' }).brand).toEqual({
      welcomeMessage: 'Bienvenue',
      logoUrl: '/logo',
    })
  })

  it('adds no reveal group to a server that sent none', () => {
    const { reveal: _reveal, ...older } = eventSettings()

    expect(applySettingsPatch(older, { reveal: { film: true } })).not.toHaveProperty('reveal')
  })
})
