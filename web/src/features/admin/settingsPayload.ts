import type { EventSettingsPatch } from '../../lib/api/client'
import type { EventSettingsDto } from '../../lib/api/dto'
import { wallChanges } from '../../lib/wallDisplayOptions'

type RevealDto = NonNullable<EventSettingsDto['reveal']>

/**
 * The keys of the reveal group the host changed (spec 23), or `undefined` when none was. Per key, as
 * `wall`, and for a stronger reason: the hour can be moved by "Révéler maintenant" from the console
 * while this form is open, and a whole group sent back would carry the old hour against the new one
 * (`eventSettings.revealDone`). An absent group (an older server) is no change.
 */
export const revealChanges = (
  draft: RevealDto | undefined,
  loaded: RevealDto | undefined,
): Partial<RevealDto> | undefined => {
  if (draft === undefined || loaded === undefined) return undefined
  const changes: { -readonly [K in keyof RevealDto]?: RevealDto[K] } = {}
  if (draft.enabled !== loaded.enabled) changes.enabled = draft.enabled
  if (draft.at !== loaded.at) changes.at = draft.at
  if (draft.film !== loaded.film) changes.film = draft.film
  return Object.keys(changes).length === 0 ? undefined : changes
}

/**
 * The keys of the voice group this form changed (spec 25), or `undefined` when none.
 *
 * Only the changed keys go, like the wall's: the server merges the group per key, and an opening
 * time that has passed cannot be written back to anything but itself (`voiceOpenDone`), so a save
 * that only touched the wall must not carry a stale `opensAtMs` along.
 */
export const voiceChanges = (
  draft: EventSettingsDto['guestbookVoice'],
  loaded: EventSettingsDto['guestbookVoice'],
): Partial<EventSettingsDto['guestbookVoice']> | undefined => {
  const changed: { enabled?: boolean; sealed?: boolean; opensAtMs?: number | null } = {}
  if (draft.enabled !== loaded.enabled) changed.enabled = draft.enabled
  if (draft.sealed !== loaded.sealed) changed.sealed = draft.sealed
  if (draft.opensAtMs !== loaded.opensAtMs) changed.opensAtMs = draft.opensAtMs
  return Object.keys(changed).length === 0 ? undefined : changed
}

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
export const toSettingsPatch = (
  settings: EventSettingsDto,
  loaded?: EventSettingsDto,
): EventSettingsPatch => {
  // The wall group is merged per key on the server, so only the keys this form changed are sent
  // (spec 13): the panel on the wall writes the same group, and a whole object would erase it.
  // A caller that did not load the group (the ambiance page) sends none.
  const { wall, reveal, guestbookVoice, ...rest } = settings
  const voicePatch =
    loaded === undefined ? undefined : voiceChanges(guestbookVoice, loaded.guestbookVoice)
  const wallPatch = loaded === undefined ? undefined : wallChanges(wall, loaded.wall)
  // Per key too, and never from a caller that did not load the group (the ambiance page).
  const revealPatch = loaded === undefined ? undefined : revealChanges(reveal, loaded.reveal)
  return {
    ...rest,
    ...(wallPatch === undefined ? {} : { wall: wallPatch }),
    ...(revealPatch === undefined ? {} : { reveal: revealPatch }),
    ...(voicePatch === undefined ? {} : { guestbookVoice: voicePatch }),
    // The message goes at the top level, where the route reads it; `brand` stays read-only. Not sent at
    // all when the server did not say (an older build), so a save never clears what it never saw.
    ...(settings.brand === undefined ? {} : { welcomeMessage: settings.brand.welcomeMessage }),
    theme: {
      accentHue: settings.theme.accentHue,
      fonts: settings.theme.fonts,
      frame: settings.theme.frame,
      ambiance: settings.theme.ambiance,
      // Sent back as it was read: the ambiance's own page edits it, and a save from this form
      // must not drop what the host made there (the server refuses `custom` without its object).
      ...(settings.theme.custom === undefined
        ? {}
        : {
            custom: {
              ground: settings.theme.custom.ground,
              groundHue: settings.theme.custom.groundHue,
              faces: settings.theme.custom.faces,
            },
          }),
    },
  }
}

/**
 * The fields a change to the settings page moved, as one `PATCH /settings` names them, and nothing
 * else: the page saves as the host changes it, so a choice made on the wall's panel or in another tab
 * since the page loaded must not be written back over by a field the host never touched here.
 *
 * Built from {@link toSettingsPatch} on both sides, so a field is compared in the shape it is sent:
 * the theme whole and without its photograph, the three per-key groups key by key, the welcome
 * message at the top level.
 */
export const settingsChanges = (
  next: EventSettingsDto,
  current: EventSettingsDto,
): EventSettingsPatch => {
  const after = toSettingsPatch(next, current)
  const before = toSettingsPatch(current, current)
  const changed: Partial<Record<keyof EventSettingsPatch, unknown>> = {}
  for (const key of Object.keys(after) as Array<keyof EventSettingsPatch>) {
    if (JSON.stringify(after[key]) !== JSON.stringify(before[key])) changed[key] = after[key]
  }
  // Sound: every value in `changed` was read from `after` under the same key.
  return changed as EventSettingsPatch
}
