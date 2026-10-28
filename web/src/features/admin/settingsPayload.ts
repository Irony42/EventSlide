import type { EventSettingsDto } from '../../lib/api/dto'

/**
 * The settings form's draft, as `PATCH /settings` reads it: the theme without the
 * photograph's URL.
 *
 * The form edits a whole `EventSettingsDto`, and its theme carries `groundUrl` so the page can
 * show the host's own photograph of the venue (ADR 0010, decision 8). That field is read-only
 * on the wire: the photograph has routes of its own, the settings schema's theme is a strict
 * object that refuses an unknown key, and a save that could name a URL would let a client
 * point an event's ground at any path. The theme is rebuilt field by field rather than
 * stripped of one, so whatever the server adds to the theme next is not sent by accident.
 */
export const toSettingsPatch = (settings: EventSettingsDto): EventSettingsDto => ({
  ...settings,
  theme: {
    accentHue: settings.theme.accentHue,
    fonts: settings.theme.fonts,
    frame: settings.theme.frame,
    material: settings.theme.material,
    ambiance: settings.theme.ambiance,
  },
})
