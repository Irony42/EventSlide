import { describe, expect, it } from 'vitest'
import { eventSettings } from '../../testing/renderWithProviders'
import { toSettingsPatch } from './settingsPayload'

describe('toSettingsPatch', () => {
  it('leaves the photograph’s URL out of the theme, which the server’s strict schema would refuse', () => {
    const draft = eventSettings({
      theme: {
        accentHue: 345,
        fonts: 'serif',
        frame: 'round',
        material: 'plain',
        ambiance: 'guinguette',
        groundUrl: `/api/events/camille-et-sacha/venue-photo/${'ab'.repeat(32)}`,
      },
    })

    expect(toSettingsPatch(draft).theme).toEqual({
      accentHue: 345,
      fonts: 'serif',
      frame: 'round',
      material: 'plain',
      ambiance: 'guinguette',
    })
    expect(toSettingsPatch(draft).theme).not.toHaveProperty('groundUrl')
  })

  it('keeps every other setting as the host left it', () => {
    const draft = eventSettings({ moderation: 'auto', retentionDays: 30 })

    expect(toSettingsPatch(draft)).toMatchObject({ moderation: 'auto', retentionDays: 30 })
  })
})
