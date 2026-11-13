import type { TourStep } from '../../design-system/components/GuidedTour'
import type { EventRole, EventStatus } from '../../lib/api/dto'
import { canManageEvent } from '../../lib/eventLifecycle'
import type { UiText } from '../../lib/i18n/translations'

/**
 * The first visit's guided tour of an event's page (surface: the host and the moderator).
 *
 * Five stops after the welcome, in the order a host needs them: the "Maintenant" card, the
 * access card, the lifecycle buttons, the two tiles of the evening, the overview; then the
 * "Visite guidée" button, so the host learns where the tour lives. The page marks each region
 * with `data-tour`; a stop whose region is not on the page (a moderator has no lifecycle
 * buttons) is left out by the tour itself, so these rules only decide what each stop *says*.
 */

export interface EventTourFacts {
  readonly name: string
  readonly status: EventStatus
  readonly role: EventRole
  readonly moderation: 'manual' | 'auto'
}

/** What the lifecycle stop says, by status. An archived event has no lifecycle left to explain. */
const lifecycleStop = (status: EventStatus, text: UiText): TourStep | null => {
  const copy =
    status === 'draft'
      ? { title: text.admin.tourOpenTitle, body: text.admin.tourOpenBody }
      : status === 'live'
        ? { title: text.admin.tourCloseTitle, body: text.admin.tourCloseBody }
        : status === 'closed'
          ? { title: text.admin.tourAfterTitle, body: text.admin.tourAfterBody }
          : null
  return copy === null ? null : { id: 'lifecycle', targets: ['lifecycle'], side: 'bottom', ...copy }
}

export const eventTourSteps = (facts: EventTourFacts, text: UiText): readonly TourStep[] => {
  const owner = canManageEvent(facts.role)
  const lifecycle = owner ? lifecycleStop(facts.status, text) : null
  // The queue and the screen are the evening's: once it is over they are not what to learn first.
  const evening = facts.status === 'draft' || facts.status === 'live'

  const steps: (TourStep | null)[] = [
    {
      id: 'welcome',
      targets: [],
      title: owner ? text.admin.tourWelcomeTitle : text.admin.tourWelcomeModeratorTitle,
      body: owner
        ? text.admin.tourWelcomeBody(facts.name)
        : text.admin.tourWelcomeModeratorBody(facts.name),
    },
    {
      id: 'now',
      targets: ['now'],
      side: 'bottom',
      title: text.admin.tourNowTitle,
      body: text.admin.tourNowBody,
    },
    {
      id: 'access',
      targets: ['access'],
      side: 'left',
      title: text.admin.tourAccessTitle,
      body: text.admin.tourAccessBody,
    },
    lifecycle,
    evening
      ? {
          id: 'evening',
          targets: ['moderate', 'wall'],
          side: 'right',
          title: text.admin.tourEveningTitle,
          body:
            facts.moderation === 'auto'
              ? text.admin.tourEveningBodyAuto
              : text.admin.tourEveningBodyManual,
        }
      : null,
    {
      id: 'overview',
      targets: ['overview'],
      side: 'top',
      title: text.admin.tourOverviewTitle,
      body: text.admin.tourOverviewBody,
    },
    {
      id: 'replay',
      targets: ['tourButton'],
      side: 'bottom',
      title: text.admin.tourEndTitle,
      body: text.admin.tourEndBody,
    },
  ]
  return steps.filter((step): step is TourStep => step !== null)
}

/**
 * Whether the page offers the tour by itself on this visit. Never to an account that saw or
 * skipped it, and never in the middle of the evening while photos wait: the host who opens the
 * page then has a queue to clear, not a screen to discover. The button replays it either way.
 */
export const offersTourOnArrival = (facts: {
  readonly toursSeen: readonly string[]
  readonly status: EventStatus
  readonly pendingCount: number
}): boolean =>
  !facts.toursSeen.includes('eventPage') && !(facts.status === 'live' && facts.pendingCount > 0)
