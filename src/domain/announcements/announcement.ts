import { DomainError } from '../shared/errors'
import type { AnnouncementId, EventId, UserId } from '../shared/ids'
import { err, ok, type Result } from '../shared/result'
import { AnnouncementText } from './announcementText'
import {
  ANNOUNCEMENT_DURATION_SECONDS,
  DEFAULT_SCHEDULED_COUNTDOWN_SECONDS,
  parseAnnouncementCountdown,
  parseAnnouncementDuration,
  parseAnnouncementInstant,
  parseAnnouncementKind,
  type AnnouncementKind,
} from './announcementRules'
import { announcementPhaseAt, type AnnouncementPhase } from './announcementSchedule'

/**
 * One announcement scheduled on an event's wall (spec 21): a sentence, a kind, a moment, a
 * duration and, for a fullscreen card, an optional countdown. "Gâteau à 22 h".
 *
 * It is a plain record plus the rules of its own edits. Everything about *when* is derived by
 * {@link announcementPhaseAt}: no state is stored and nothing ticks.
 */

export interface AnnouncementProps {
  readonly id: AnnouncementId
  readonly eventId: EventId
  readonly text: AnnouncementText
  readonly kind: AnnouncementKind
  /** The instant the announcement appears (the countdown, if any, runs up to it). */
  readonly at: Date
  readonly durationSeconds: number
  readonly countdownSeconds: number
  /** A host account, never a guest. */
  readonly createdBy: UserId | null
  readonly createdAt: Date
}

/** The raw fields of a creation, as they arrive: the domain parses every one. */
export interface NewAnnouncement {
  readonly eventId: EventId
  readonly text: unknown
  /** Absent: `fullscreen`. */
  readonly kind?: unknown
  /** Absent: a launch, `at` is now and there is no countdown. */
  readonly at?: unknown
  /** Absent: the kind's default. */
  readonly durationSeconds?: unknown
  /** Absent: 300 s for a scheduled fullscreen card, none otherwise. */
  readonly countdownSeconds?: unknown
  readonly createdBy: UserId
}

/** The fields of an edit; an absent one is left as it was. */
export interface AnnouncementPatch {
  readonly text?: unknown
  readonly kind?: unknown
  readonly at?: unknown
  readonly durationSeconds?: unknown
  readonly countdownSeconds?: unknown
}

export class Announcement {
  private constructor(private readonly props: AnnouncementProps) {}

  static create(
    input: NewAnnouncement,
    id: AnnouncementId,
    now: Date,
  ): Result<Announcement, DomainError> {
    const text = AnnouncementText.create(input.text)
    if (!text.ok) return text

    const kind = parseAnnouncementKind(input.kind)
    if (!kind.ok) return kind

    const launch = input.at === undefined
    const at = launch ? ok(now) : parseAnnouncementInstant(input.at, now)
    if (!at.ok) return at

    const duration = parseAnnouncementDuration(
      kind.value,
      input.durationSeconds === undefined
        ? ANNOUNCEMENT_DURATION_SECONDS[kind.value].default
        : input.durationSeconds,
    )
    if (!duration.ok) return duration

    const defaultCountdown =
      kind.value === 'fullscreen' && !launch ? DEFAULT_SCHEDULED_COUNTDOWN_SECONDS : 0
    const countdown = parseAnnouncementCountdown(
      kind.value,
      input.countdownSeconds === undefined ? defaultCountdown : input.countdownSeconds,
    )
    if (!countdown.ok) return countdown

    return ok(
      new Announcement({
        id,
        eventId: input.eventId,
        text: text.value,
        kind: kind.value,
        at: at.value,
        durationSeconds: duration.value,
        // A launch has no countdown: it starts now.
        countdownSeconds: launch ? 0 : countdown.value,
        createdBy: input.createdBy,
        createdAt: now,
      }),
    )
  }

  /** Rehydrate from storage. See `Photo.restore` for why this trusts the row. */
  static restore(props: AnnouncementProps): Announcement {
    return new Announcement(props)
  }

  get id(): AnnouncementId {
    return this.props.id
  }
  get eventId(): EventId {
    return this.props.eventId
  }
  get text(): AnnouncementText {
    return this.props.text
  }
  get kind(): AnnouncementKind {
    return this.props.kind
  }
  get at(): Date {
    return this.props.at
  }
  get durationSeconds(): number {
    return this.props.durationSeconds
  }
  get countdownSeconds(): number {
    return this.props.countdownSeconds
  }

  phaseAt(now: Date): AnnouncementPhase {
    return announcementPhaseAt(this.props, now.getTime())
  }

  /**
   * An edit (rule 11). While `upcoming` or `counting` every field changes, the kind included, and
   * the duration and countdown are checked again for the resulting kind. While `showing` or
   * `over` it is `409 announcement.locked`, with **one exception**: the text of a discreet
   * announcement stays editable on screen (it may stay thirty minutes and a typo is plausible;
   * removing it would restart its time). Its moment, duration, countdown and kind stay locked: a
   * field sent back unchanged is not an edit.
   */
  edit(patch: AnnouncementPatch, now: Date): Result<Announcement, DomainError> {
    const phase = this.phaseAt(now).phase

    const text =
      patch.text === undefined ? ok(this.props.text) : AnnouncementText.create(patch.text)

    if (phase === 'showing' || phase === 'over') {
      const textOnly = this.props.kind === 'discreet' && phase === 'showing'
      if (!textOnly || this.changesMoment(patch)) {
        return err(DomainError.conflict('announcement.locked'))
      }
      // The other fields were sent back unchanged (or not at all): nothing of them is re-read.
      if (!text.ok) return text
      return ok(new Announcement({ ...this.props, text: text.value }))
    }

    if (!text.ok) return text

    const kind = patch.kind === undefined ? ok(this.props.kind) : parseAnnouncementKind(patch.kind)
    if (!kind.ok) return kind

    // The moment is only parsed when it is named: a text edit on screen never re-reads it.
    const at = patch.at === undefined ? ok(this.props.at) : parseAnnouncementInstant(patch.at, now)
    if (!at.ok) return at

    const duration = parseAnnouncementDuration(
      kind.value,
      patch.durationSeconds === undefined ? this.props.durationSeconds : patch.durationSeconds,
    )
    if (!duration.ok) return duration

    // A discreet announcement has no countdown: moving to that kind drops it rather than
    // refusing an edit that never mentioned it. Naming a non-zero one is still refused.
    const keptCountdown = kind.value === 'discreet' ? 0 : this.props.countdownSeconds
    const countdown = parseAnnouncementCountdown(
      kind.value,
      patch.countdownSeconds === undefined ? keptCountdown : patch.countdownSeconds,
    )
    if (!countdown.ok) return countdown

    return ok(
      new Announcement({
        ...this.props,
        text: text.value,
        kind: kind.value,
        at: at.value,
        durationSeconds: duration.value,
        countdownSeconds: countdown.value,
      }),
    )
  }

  /** Whether an edit names a field other than the text with a value that is not the current one. */
  private changesMoment(patch: AnnouncementPatch): boolean {
    return (
      (patch.kind !== undefined && patch.kind !== this.props.kind) ||
      (patch.at !== undefined &&
        new Date(String(patch.at)).getTime() !== this.props.at.getTime()) ||
      (patch.durationSeconds !== undefined &&
        patch.durationSeconds !== this.props.durationSeconds) ||
      (patch.countdownSeconds !== undefined &&
        patch.countdownSeconds !== this.props.countdownSeconds)
    )
  }

  /**
   * "Lancer maintenant" (rule 12): `at` is now and the countdown none, from `upcoming`,
   * `counting` or `over` ("Relancer"). Text, kind and duration are kept. One already on screen is
   * `409 announcement.showing`.
   */
  launch(now: Date): Result<Announcement, DomainError> {
    if (this.phaseAt(now).phase === 'showing') {
      return err(DomainError.conflict('announcement.showing'))
    }
    return ok(new Announcement({ ...this.props, at: now, countdownSeconds: 0 }))
  }

  toProps(): AnnouncementProps {
    return this.props
  }
}
