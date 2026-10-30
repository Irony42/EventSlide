import type { UiText } from '../../../lib/i18n/translations'
import type { ModerationDecision, PhotoStatus } from '../../../lib/api/dto'

/**
 * The words on a decision button, for the photo it sits on.
 *
 * `publish` is one verb on the wire and three sentences to a host: for a photo waiting it
 * is "Publier", for one they took off the screen it is "Remettre à l'écran", and for one
 * they refused it is "Publier quand même" — the same call, but a host who reads "Publier"
 * on a photo they refused last week wonders whether it has ever been on the wall. Wording
 * only: which decisions a photo may take is the server's answer (`allowedDecisions`), not
 * something this file works out.
 *
 * A plain function taking the copy as a parameter, like `web/src/lib/photoAlt.ts`, so the
 * language is the one the moderator chose.
 */
export interface DecisionWording {
  /** The visible label. */
  readonly label: string
  /** What a screen reader says: the same verb, naming the photo it acts on. */
  readonly ariaLabel: string
}

export const decisionWording = (
  decision: ModerationDecision,
  status: PhotoStatus,
  author: string,
  text: UiText,
): DecisionWording => {
  const m = text.moderation
  switch (decision) {
    case 'reject':
      return { label: m.reject, ariaLabel: m.rejectPhoto(author) }
    case 'hide':
      return { label: m.hide, ariaLabel: m.hidePhoto(author) }
    case 'publish':
      if (status === 'hidden') return { label: m.republish, ariaLabel: m.republishPhoto(author) }
      if (status === 'rejected') {
        return { label: m.publishAnyway, ariaLabel: m.publishAnywayPhoto(author) }
      }
      return { label: m.publish, ariaLabel: m.publishPhoto(author) }
  }
}

const DISPLAY_ORDER: readonly ModerationDecision[] = ['publish', 'hide', 'reject']

/**
 * The offered decisions, in the order they sit on a button row: the one that gives the
 * photo a place first, the gentle removal next, and the refusal — the one a guest sees
 * as "Non retenue" — last and furthest from where a thumb lands first.
 */
export const inDisplayOrder = (
  decisions: readonly ModerationDecision[],
): readonly ModerationDecision[] => DISPLAY_ORDER.filter((decision) => decisions.includes(decision))
