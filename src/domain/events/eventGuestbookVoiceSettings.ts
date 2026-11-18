import { DomainError } from '../shared/errors'
import type { EventStatus } from './eventStatus'

/**
 * What the host decides about voice messages in the guestbook (spec 25, rules 10 and 13). One flat
 * object, one level deep, in the `guestbookVoice` key of `events.settings`.
 *
 * **Merged field by field**, like `wall`: the settings page and the "open now" button write at
 * different moments, each sending only what it changed, and replacing the object whole would let
 * one erase the other's choice.
 *
 * **Every default is "as before"**: off, not sealed, no opening time. A key that is absent reads
 * that way (a read, not a migration): opening a voice channel onto a room whose host was never
 * consulted is not a change an upgrade has the right to make.
 *
 * `sealed` is the host's own listening, kept secret until the party is over. The code says
 * `sealed`; the interface says "kept secret", never "scellé".
 */
export interface EventGuestbookVoiceSettings {
  /** Only effective when `allowGuestbook` is on as well. */
  readonly enabled: boolean
  /** Nobody listens before the end of the evening (or {@link opensAtMs}). */
  readonly sealed: boolean
  /**
   * When the secret lifts, as an instant in milliseconds, or `null` for "when the event ends".
   * "Open now" writes the server's now. **One-way**: once it has passed it cannot move into the
   * future (`voiceSettingsViolation`).
   */
  readonly opensAtMs: number | null
}

export type EventGuestbookVoiceSettingsPatch = Partial<EventGuestbookVoiceSettings>

export const DEFAULT_GUESTBOOK_VOICE_SETTINGS: EventGuestbookVoiceSettings = {
  enabled: false,
  sealed: false,
  opensAtMs: null,
}

/** The stored object with the patch's own keys applied: an absent key leaves the stored one alone. */
export const mergeGuestbookVoiceSettings = (
  base: EventGuestbookVoiceSettings,
  patch: EventGuestbookVoiceSettingsPatch | undefined,
): EventGuestbookVoiceSettings => ({
  enabled: patch?.enabled === undefined ? base.enabled : patch.enabled,
  sealed: patch?.sealed === undefined ? base.sealed : patch.sealed,
  opensAtMs: patch?.opensAtMs === undefined ? base.opensAtMs : patch.opensAtMs,
})

/** The part of the rule that needs no clock: an opening time is an instant, not `NaN`. */
export const voiceOpensAtViolation = (voice: EventGuestbookVoiceSettings): DomainError | null =>
  voice.opensAtMs !== null && !Number.isFinite(voice.opensAtMs)
    ? DomainError.invalid('eventSettings.voiceOpensAtInvalid')
    : null

/**
 * The refusal of a host's choice.
 *
 * `previous` is what is stored and `next` what the save would store. An opening time that has
 * **already passed** is the secret lifted for good: moving it into the future (or clearing it)
 * would seal what a moderator may already have heard. A time still in the future moves freely.
 */
export const voiceSettingsViolation = (
  previous: EventGuestbookVoiceSettings,
  next: EventGuestbookVoiceSettings,
  nowMs: number,
): DomainError | null => {
  const shape = voiceOpensAtViolation(next)
  if (shape !== null) return shape
  const alreadyOpened = previous.opensAtMs !== null && previous.opensAtMs <= nowMs
  if (alreadyOpened && (next.opensAtMs === null || next.opensAtMs > nowMs)) {
    return DomainError.conflict('eventSettings.voiceOpenDone')
  }
  return null
}

/**
 * Whether the voices may be listened to now.
 *
 * True when the book is **not sealed**, when its `opensAt` has come (the instant itself included),
 * or when the **event is no longer `live`**: "until the end of the party", read literally and
 * derived from the status, so no write happens at closing and no closing path (by hand, scheduled,
 * offboarding) needs to know about it. A reopened event is `live` again and re-seals unless the
 * host opened it by hand, which is the assumed consequence of deriving rather than recording.
 */
export const isVoiceOpen = (
  settings: EventGuestbookVoiceSettings,
  event: { readonly status: EventStatus },
  now: Date,
): boolean => {
  if (!settings.sealed) return true
  if (settings.opensAtMs !== null && settings.opensAtMs <= now.getTime()) return true
  return event.status === 'closed' || event.status === 'archived'
}

/** Reads the stored `guestbookVoice` object tolerantly: absent or unreadable fields take their default. */
export const restoreGuestbookVoiceSettings = (raw: unknown): EventGuestbookVoiceSettings => {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const opensAt = record['opensAtMs']
  return {
    enabled: record['enabled'] === true,
    sealed: record['sealed'] === true,
    opensAtMs:
      typeof opensAt === 'number' && Number.isFinite(opensAt)
        ? opensAt
        : DEFAULT_GUESTBOOK_VOICE_SETTINGS.opensAtMs,
  }
}
