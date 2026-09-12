import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'

/**
 * The per-event policy a host can change without touching code.
 *
 * Every field has a default, because the create-event form asks for a name and nothing
 * else: a host setting up a wedding at 18:00 must not have to make seven policy
 * decisions first. The defaults are the safe ones — a decision before the wall, and
 * nothing deleted automatically.
 */

export const MODERATION_MODES = ['manual', 'auto'] as const

/**
 * `manual` holds every photo until a host decides. `auto` publishes on ingest and
 * records an `automatic` reviewer on the photo, so "how did that reach the screen"
 * always has an answer.
 */
export type ModerationMode = (typeof MODERATION_MODES)[number]

/** Narrows a value read back from the `settings` JSON column or from a form. */
export const isModerationMode = (value: unknown): value is ModerationMode =>
  typeof value === 'string' && (MODERATION_MODES as readonly string[]).includes(value)

const MS_PER_SECOND = 1_000

interface Range {
  readonly min: number
  readonly max: number
}

/** 0 turns the window off without turning the feature off; the ceiling is one day. */
const GRACE_SECONDS: Range = { min: 0, max: 86_400 }
/** Ten years. An upper bound only so that closedAt + retentionDays stays a real date. */
const RETENTION_DAYS: Range = { min: 1, max: 3_650 }
/** A cap is a fairness tool at a party, not a storage control — that is the quota. */
const MAX_PHOTOS_PER_GUEST: Range = { min: 1, max: 10_000 }

export interface EventSettingsProps {
  readonly moderation: ModerationMode
  readonly allowCaptions: boolean
  readonly allowReactions: boolean
  /**
   * Whether guests may send short video clips as well as photographs.
   *
   * The host's veto over the feature, and separate from whether the box *can* transcode
   * one: a deployment with no encoder refuses a clip with `clip.transcoderUnavailable`,
   * which is an apology, while this is a decision — some rooms do not want video on the
   * wall, and the guest is entitled to be told which of the two it was.
   *
   * Default on, like captions and reactions: an event upgraded into this version gets
   * the feature, and every clip still waits for a moderation decision like everything
   * else.
   */
  readonly allowClips: boolean
  readonly allowGuestSelfDelete: boolean
  readonly guestSelfDeleteGraceSeconds: number
  /** `null` keeps the album forever. */
  readonly retentionDays: number | null
  /** `null` is unlimited. */
  readonly maxPhotosPerGuest: number | null
}

/**
 * A partial update. Absent means "leave it alone", `null` means "no limit" — two
 * different intents from the same settings form, which is why
 * `exactOptionalPropertyTypes` is on and why these fields are not merged with `??`.
 */
export type EventSettingsPatch = Partial<EventSettingsProps>

const DEFAULTS: EventSettingsProps = {
  moderation: 'manual',
  allowCaptions: true,
  allowReactions: true,
  allowClips: true,
  allowGuestSelfDelete: true,
  guestSelfDeleteGraceSeconds: 900,
  retentionDays: null,
  maxPhotosPerGuest: null,
}

const pick = <T>(update: T | undefined, current: T): T => (update === undefined ? current : update)

const violation = (value: number, range: Range, code: string): DomainError | null =>
  Number.isInteger(value) && value >= range.min && value <= range.max
    ? null
    : DomainError.invalid(code, { min: range.min, max: range.max })

const nullableViolation = (value: number | null, range: Range, code: string): DomainError | null =>
  value === null ? null : violation(value, range, code)

export class EventSettings {
  private constructor(private readonly props: EventSettingsProps) {}

  /** A copy, so `toProps()` can never hand a caller the module-level defaults object. */
  static default(): EventSettings {
    return new EventSettings({ ...DEFAULTS })
  }

  static create(patch: EventSettingsPatch): Result<EventSettings, DomainError> {
    return EventSettings.build(DEFAULTS, patch)
  }

  /** A partial update, validated as a whole so one field cannot be saved out of range. */
  with(patch: EventSettingsPatch): Result<EventSettings, DomainError> {
    return EventSettings.build(this.props, patch)
  }

  private static build(
    base: EventSettingsProps,
    patch: EventSettingsPatch,
  ): Result<EventSettings, DomainError> {
    const merged: EventSettingsProps = {
      moderation: pick(patch.moderation, base.moderation),
      allowCaptions: pick(patch.allowCaptions, base.allowCaptions),
      allowReactions: pick(patch.allowReactions, base.allowReactions),
      allowClips: pick(patch.allowClips, base.allowClips),
      allowGuestSelfDelete: pick(patch.allowGuestSelfDelete, base.allowGuestSelfDelete),
      guestSelfDeleteGraceSeconds: pick(
        patch.guestSelfDeleteGraceSeconds,
        base.guestSelfDeleteGraceSeconds,
      ),
      retentionDays: pick(patch.retentionDays, base.retentionDays),
      maxPhotosPerGuest: pick(patch.maxPhotosPerGuest, base.maxPhotosPerGuest),
    }

    const failure =
      violation(
        merged.guestSelfDeleteGraceSeconds,
        GRACE_SECONDS,
        'eventSettings.graceSecondsInvalid',
      ) ??
      nullableViolation(
        merged.retentionDays,
        RETENTION_DAYS,
        'eventSettings.retentionDaysInvalid',
      ) ??
      nullableViolation(
        merged.maxPhotosPerGuest,
        MAX_PHOTOS_PER_GUEST,
        'eventSettings.maxPhotosPerGuestInvalid',
      )

    return failure === null ? ok(new EventSettings(merged)) : err(failure)
  }

  get moderation(): ModerationMode {
    return this.props.moderation
  }

  get allowCaptions(): boolean {
    return this.props.allowCaptions
  }

  get allowReactions(): boolean {
    return this.props.allowReactions
  }

  get allowClips(): boolean {
    return this.props.allowClips
  }

  get allowGuestSelfDelete(): boolean {
    return this.props.allowGuestSelfDelete
  }

  get guestSelfDeleteGraceSeconds(): number {
    return this.props.guestSelfDeleteGraceSeconds
  }

  /** The Photo entity's permission predicates work in milliseconds. */
  get guestSelfDeleteGraceMs(): number {
    return this.props.guestSelfDeleteGraceSeconds * MS_PER_SECOND
  }

  get retentionDays(): number | null {
    return this.props.retentionDays
  }

  get maxPhotosPerGuest(): number | null {
    return this.props.maxPhotosPerGuest
  }

  /** Snapshot for the repository to serialise into the `settings` JSON column. */
  toProps(): EventSettingsProps {
    return this.props
  }

  /**
   * Exposed so the zod schema at the HTTP boundary and the host-facing form can state
   * the same bounds instead of restating them and drifting.
   */
  static readonly graceSecondsRange = GRACE_SECONDS
  static readonly retentionDaysRange = RETENTION_DAYS
  static readonly maxPhotosPerGuestRange = MAX_PHOTOS_PER_GUEST
}
