import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import {
  createEventTheme,
  DEFAULT_EVENT_THEME,
  restoreEventTheme,
  type EventThemeProps,
} from './eventTheme'

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
   * Default on, like captions and reactions — but read that as "a host who has not
   * thought about it gets the feature", which is not the same sentence as "an upgraded
   * event gets it". An event created before migration 003 has a settings blob with no
   * such key, and `sqliteEventRepository.settingsOf` deliberately reads an **absent key
   * as `false`**: switching an 80 MB upload path and a CPU-bound encoder onto a wedding
   * that may be live right now is a change its host never consented to. The two answers
   * differ on purpose, and the adapter is where that difference is explained.
   *
   * Every clip still waits for a moderation decision like everything else.
   */
  readonly allowClips: boolean
  readonly allowGuestSelfDelete: boolean
  readonly guestSelfDeleteGraceSeconds: number
  /** `null` keeps the album forever. */
  readonly retentionDays: number | null
  /** `null` is unlimited. */
  readonly maxPhotosPerGuest: number | null
  /**
   * How the event looks: an accent hue, a font pairing, a frame style (roadmap 2.2) and
   * the material its panes are made of (roadmap 11.5).
   *
   * One object rather than four sibling fields, and read together the way
   * `eventScheduleBody` reads its two instants: they are one decision made on one form,
   * and the legibility rule is about the palette as a whole rather than about a field.
   *
   * Validated by `eventTheme.ts`, which is where the rule lives. An event that never
   * chose one holds `DEFAULT_EVENT_THEME`, which renders exactly as the product did
   * before this field existed — see `sqliteEventRepository.settingsOf` for what an
   * absent key means, which is a different question.
   */
  readonly theme: EventThemeProps
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
  theme: DEFAULT_EVENT_THEME,
}

const pick = <T>(update: T | undefined, current: T): T => (update === undefined ? current : update)

const violation = (value: number, range: Range, code: string): DomainError | null =>
  Number.isInteger(value) && value >= range.min && value <= range.max
    ? null
    : DomainError.invalid(code, { min: range.min, max: range.max })

const nullableViolation = (value: number | null, range: Range, code: string): DomainError | null =>
  value === null ? null : violation(value, range, code)

/**
 * Which of the theme's two checks apply, in `eventTheme.ts`.
 *
 * A host **choosing** a theme is judged on legibility; a theme **read back** is judged
 * only on shape. That asymmetry has one reason and it is written out where the two
 * functions are defined: a legibility rule somebody tightens must refuse the next choice,
 * not brick the events that were configured under the old one.
 */
type ThemeCheck = (theme: EventThemeProps) => Result<EventThemeProps, DomainError>

/**
 * The checked theme, or the error that refused it.
 *
 * The value matters, not only the verdict: the read path answers `ok` with the **default
 * theme** for a stored hue that is not a point on the circle, because a cosmetic field
 * must not be able to fail `findById` and take the wall, the join page and the settings
 * page down with it. Dropping the returned value and keeping the merged one would store
 * the malformed hue anyway and make that fallback a no-op.
 */
const checkedTheme = (
  theme: EventThemeProps,
  check: ThemeCheck,
): { theme: EventThemeProps; failure: null } | { theme: null; failure: DomainError } => {
  const validated = check(theme)
  return validated.ok
    ? { theme: validated.value, failure: null }
    : { theme: null, failure: validated.error }
}

export class EventSettings {
  private constructor(private readonly props: EventSettingsProps) {}

  /** A copy, so `toProps()` can never hand a caller the module-level defaults object. */
  static default(): EventSettings {
    return new EventSettings({ ...DEFAULTS })
  }

  static create(patch: EventSettingsPatch): Result<EventSettings, DomainError> {
    return EventSettings.build(DEFAULTS, patch, createEventTheme)
  }

  /**
   * A partial update, validated as a whole so one field cannot be saved out of range.
   *
   * **The theme is judged as a choice only when the patch makes one.** A host saving
   * "allow reactions: off" has chosen nothing about colour, so their stored theme is
   * rebuilt on the read path's terms — shape, not legibility.
   *
   * Without that distinction the split between `createEventTheme` and
   * `restoreEventTheme` is defeated on the one path a host uses every day. Raise
   * `MIN_STATUS_SEPARATION`, or move `--success` a few degrees, and an event themed
   * under the old rule keeps rendering — the read path is lenient by design — while
   * every save on its settings page answers `400 eventTheme.accentTooCloseToStatus`
   * about a field the host did not touch. Moderation mode, retention, the per-guest
   * cap and the self-delete window all become unsavable, and the lenient read path is
   * what makes it silent: nothing else in the product complains.
   */
  with(patch: EventSettingsPatch): Result<EventSettings, DomainError> {
    const check = patch.theme === undefined ? restoreEventTheme : createEventTheme
    return EventSettings.build(this.props, patch, check)
  }

  /**
   * Rebuild what a repository read back, rather than what a host is choosing.
   *
   * Every range is still enforced — a stored policy the domain refuses means the file was
   * hand-edited or written by another program, and defaulting it silently is the failure
   * this strictness exists to prevent. The theme is the one field judged differently, and
   * `restoreEventTheme` says why: a legibility rule somebody tightens must refuse the
   * next choice, not take a wedding that is live right now off the screen.
   */
  static restore(props: EventSettingsProps): Result<EventSettings, DomainError> {
    return EventSettings.build(DEFAULTS, props, restoreEventTheme)
  }

  private static build(
    base: EventSettingsProps,
    patch: EventSettingsPatch,
    checkTheme: ThemeCheck,
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
      // Replaced whole, never merged field by field: a half-applied theme is a palette
      // nobody chose, and the rule below judges them together.
      theme: pick(patch.theme, base.theme),
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

    if (failure !== null) return err(failure)

    const theme = checkedTheme(merged.theme, checkTheme)
    if (theme.failure !== null) return err(theme.failure)

    return ok(new EventSettings({ ...merged, theme: theme.theme }))
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

  get theme(): EventThemeProps {
    return this.props.theme
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
