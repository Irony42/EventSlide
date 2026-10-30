import type { BadgeTone } from '../../design-system/components/Badge'
import type { EventRole, EventStatus } from '../../lib/api/dto'
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
 * What the console offers from each status. A subset of `ALLOWED_TRANSITIONS`, on purpose.
 *
 * The label depends on where the host is coming from: `closed → live` is a reopening
 * after the speeches ran late, `draft → live` is opening the doors. One word for both
 * would be wrong in one of the two cases.
 *
 * **A live event is not offered "Archive" beside "End the evening".** The domain allows
 * `live → archived`, and the server would accept it, but archiving is terminal (the screen
 * stops, the settings freeze, nothing brings it back) and the two buttons sit one thumb-width
 * apart: a slip at 23:00 would switch the projector off in front of the room. The way to
 * archive is to end the evening first, which is also the order a host thinks in.
 * `eventLifecycle.test.ts` pins both tables, the domain's and this subset.
 */
const TRANSITIONS: Readonly<Record<EventStatus, (text: UiText) => readonly LifecycleAction[]>> = {
  draft: (text) => [
    { to: 'live', label: text.admin.goLive, primary: true },
    { to: 'archived', label: text.admin.archiveEvent, primary: false },
  ],
  live: (text) => [{ to: 'closed', label: text.admin.closeEvent, primary: false }],
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

/**
 * Which transitions ask first, and how heavily.
 *
 * - `archive`: terminal, so it always asks and says what stops.
 * - `open`: opening a draft cannot be undone either (there is no way back to "not started
 *   yet", guests may hold the link), so it asks once, lightly.
 * - `null`: ending the evening and reopening it are each undone by the other, so they go
 *   through on one press and the toast says what happened.
 */
export type TransitionConfirmation = 'archive' | 'open'

export const confirmationFor = (
  from: EventStatus,
  to: EventStatus,
): TransitionConfirmation | null => {
  if (to === 'archived') return 'archive'
  if (from === 'draft' && to === 'live') return 'open'
  return null
}

/**
 * The toast for a transition, one sentence per move: the host learns what changed for the
 * room, not that "the new state is saved". `draft → live` and `closed → live` are different
 * moments and get different words.
 */
export const transitionNotice = (from: EventStatus, to: EventStatus, text: UiText): string => {
  if (to === 'archived') return text.admin.noticeArchived
  if (to === 'closed') return text.admin.noticeClosed
  if (to === 'live') return from === 'closed' ? text.admin.noticeReopened : text.admin.noticeOpened
  return text.admin.noticeOpened
}

/** Mirrors `allowsModeration`: an archived event is read-only. */
export const allowsModeration = (status: EventStatus): boolean => status !== 'archived'

/**
 * Mirrors `servesWall`. A closed event keeps playing — the projector is usually still
 * on while people say goodbye — but an archived one does not.
 */
export const servesWall = (status: EventStatus): boolean => status === 'live' || status === 'closed'

/**
 * Whether the host's page for an event may carry the one-time mention of the project's
 * funding (roadmap G4-02): after the event is **closed**, and at no other moment.
 *
 * **Presentation only, with nothing to mirror in the domain.** It is not a rule about the
 * event; it says when a host is least likely to be mid-task. A live event is in use — the
 * host is moderating, the wall is up — and a draft has not happened yet; asking then would
 * be asking at the wrong moment. An archived one is a read-only record the host has already
 * put away, so the invitation is not repeated there.
 */
export const offersSupport = (status: EventStatus): boolean => status === 'closed'

/**
 * Whether the console links to the wall. Broader than `servesWall`: a draft has no wall to
 * serve yet, but the host plugs the projector in before the doors open, and a tile that only
 * appears after "Open to guests" asks them to test the screen in the one minute they have
 * guests. The wall waits for the opening and starts by itself (hence the hint on the tile);
 * it is archived events only that have none.
 */
export const linksToWall = (status: EventStatus): boolean => status !== 'archived'

/**
 * Whether the evening is over, closed or archived: the host's job is now the album, not the
 * screen, and the page leads with it.
 */
export const isAfterEvening = (status: EventStatus): boolean =>
  status === 'closed' || status === 'archived'

/** Mirrors `isMutable`: settings, name and join code are frozen once archived. */
export const isMutable = (status: EventStatus): boolean => status !== 'archived'

/**
 * Mirrors `canManageEvent` (`src/domain/events/eventRole.ts`): the host's own decisions, the
 * lifecycle among them, are the owner's. A moderator is handed a laptop to approve photographs,
 * and every lifecycle request they sent would be answered `403 auth.forbidden`, so the console
 * leaves those buttons out rather than offer a control whose every press is refused.
 *
 * **A presentation of the rule, not the rule.** The server still refuses the request
 * (`changeEventStatus` asks `requireEventRole(…, 'manage')`); this only keeps the console from
 * offering what it knows will be refused. `eventLifecycle.test.ts` states the same facts as the
 * domain's own test (`eventRole.test.ts`); the two are kept alike by hand, as for the transitions.
 */
export const canManageEvent = (role: EventRole): boolean => role === 'owner'
