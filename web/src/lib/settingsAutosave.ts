import type { EventSettingsPatch } from './api/client'
import type { EventSettingsDto, EventThemeDto } from './api/dto'

/**
 * Two settings patches as one, the later one winning field by field.
 *
 * The three groups the server merges per key (`wall`, `reveal`, `guestbookVoice`) are merged per key
 * here too, so two quick choices in one group are one request that still names both. The theme is
 * always sent whole (the server's theme is a strict object), so the later one replaces the earlier.
 */
export const mergeSettingsPatch = (
  base: EventSettingsPatch,
  patch: EventSettingsPatch,
): EventSettingsPatch => ({
  ...base,
  ...patch,
  ...(patch.wall === undefined ? {} : { wall: { ...base.wall, ...patch.wall } }),
  ...(patch.reveal === undefined ? {} : { reveal: { ...base.reveal, ...patch.reveal } }),
  ...(patch.guestbookVoice === undefined
    ? {}
    : { guestbookVoice: { ...base.guestbookVoice, ...patch.guestbookVoice } }),
})

const withGround = (theme: EventThemeDto, stored: EventThemeDto): EventThemeDto => {
  const { groundUrl: _sent, ...fields } = theme
  return stored.groundUrl === undefined ? fields : { ...fields, groundUrl: stored.groundUrl }
}

/**
 * What the screen should show: the server's settings with a patch not answered yet laid over them.
 *
 * Field by field, so a control shows the host's choice at once while the request is on its way,
 * and a group the patch names only partly keeps the server's value for the rest. The photograph's
 * URL and the logo are never in a patch (they are their own requests), so they always read through.
 */
export const applySettingsPatch = (
  settings: EventSettingsDto,
  patch: EventSettingsPatch,
): EventSettingsDto => {
  const { wall, reveal, guestbookVoice, theme, brand: _brand, welcomeMessage, ...scalars } = patch
  return {
    ...settings,
    ...scalars,
    ...(wall === undefined ? {} : { wall: { ...settings.wall, ...wall } }),
    ...(reveal === undefined || settings.reveal === undefined
      ? {}
      : { reveal: { ...settings.reveal, ...reveal } }),
    ...(guestbookVoice === undefined
      ? {}
      : { guestbookVoice: { ...settings.guestbookVoice, ...guestbookVoice } }),
    // The URL of the venue photograph is the server's alone: a theme in a patch never carries it.
    ...(theme === undefined ? {} : { theme: withGround(theme, settings.theme) }),
    ...(welcomeMessage === undefined
      ? {}
      : {
          brand: { welcomeMessage, logoUrl: settings.brand?.logoUrl ?? null },
        }),
  }
}
