import type { BadgeTone } from '../../design-system/components/Badge'
import type { EventStatus } from '../../lib/api/dto'
import type { UiText } from '../../lib/i18n/translations'

/**
 * How the event lifecycle is presented, and nothing more.
 *
 * The rules themselves live in `src/domain/events/eventStatus.ts`; this file is a
 * transcription of them, because the DTO carries a status and not a list of buttons
 * and lint forbids the web app importing the domain. The server stays the authority:
 * every one of these actions is a request that can come back
 * `event.illegalTransition`, and that answer is surfaced rather than pre-empted.
 *
 * Kept in one module so there is exactly one place to correct if the lifecycle moves,
 * and `eventLifecycle.test.ts` pins each table against the domain's own.
 */

const TONES: Readonly<Record<EventStatus, BadgeTone>> = {
  draft: 'neutral',
  live: 'success',
  closed: 'accent',
  archived: 'neutral',
}

/**
 * The word for each status, read out of the table the caller is rendering in.
 *
 * A table of lookups rather than a table of strings, because this module is not a
 * component and cannot call `useTranslations`: the shape stays the one
 * `eventLifecycle.test.ts` pins against the domain, and the language arrives with the
 * question.
 */
const LABELS: Readonly<Record<EventStatus, (text: UiText) => string>> = {
  draft: (text) => text.admin.statusDraft,
  live: (text) => text.admin.statusLive,
  closed: (text) => text.admin.statusClosed,
  archived: (text) => text.admin.statusArchived,
}

export const statusTone = (status: EventStatus): BadgeTone => TONES[status]
export const statusLabel = (status: EventStatus, text: UiText): string => LABELS[status](text)

export interface LifecycleAction {
  readonly to: EventStatus
  readonly label: string
  /** The one action a host is most likely to want next, at most one per status. */
  readonly primary: boolean
}

/**
 * Mirrors `ALLOWED_TRANSITIONS`.
 *
 * The label depends on where the host is coming from: `closed → live` is a reopening
 * after the speeches ran late, `draft → live` is opening the doors. One word for both
 * would be wrong in one of the two cases.
 */
const TRANSITIONS: Readonly<Record<EventStatus, (text: UiText) => readonly LifecycleAction[]>> = {
  draft: (text) => [
    { to: 'live', label: text.admin.goLive, primary: true },
    { to: 'archived', label: text.admin.archiveEvent, primary: false },
  ],
  live: (text) => [
    { to: 'closed', label: text.admin.closeEvent, primary: false },
    { to: 'archived', label: text.admin.archiveEvent, primary: false },
  ],
  closed: (text) => [
    { to: 'live', label: text.admin.reopenEvent, primary: false },
    { to: 'archived', label: text.admin.archiveEvent, primary: false },
  ],
  // Terminal. Restoring an archived event is a restore-from-backup operation, not a
  // button, because it has to answer what happened to the media in between.
  archived: () => [],
}

export const lifecycleActions = (from: EventStatus, text: UiText): readonly LifecycleAction[] =>
  TRANSITIONS[from](text)

/** Mirrors `allowsModeration`: an archived event is read-only. */
export const allowsModeration = (status: EventStatus): boolean => status !== 'archived'

/**
 * Mirrors `servesWall`. A closed event keeps playing — the projector is usually still
 * on while people say goodbye — but an archived one does not.
 */
export const servesWall = (status: EventStatus): boolean => status === 'live' || status === 'closed'

/** Mirrors `isMutable`: settings, name and join code are frozen once archived. */
export const isMutable = (status: EventStatus): boolean => status !== 'archived'
