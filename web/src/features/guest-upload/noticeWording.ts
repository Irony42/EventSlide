import type { PrivacyNoticeDto } from '../../lib/api/dto'
import type { UiText } from '../../lib/i18n/translations'

/**
 * The privacy notice's values, worded (roadmap §5.1).
 *
 * A module rather than a component, and it takes the copy table as a parameter, for the
 * reason `lib/photoAlt.ts` does: the sentences are a pure function of what the
 * server said and which language is on screen, and that is testable without rendering a
 * page. The server decided every clause; nothing here decides whether a guest can delete
 * a photo or how long it is kept, it only says so.
 */

/** One of the four questions, and the sentences that answer it here. */
export interface NoticeSection {
  readonly term: string
  readonly sentences: readonly string[]
}

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3_600

/**
 * The self-delete window, in the largest unit that reads naturally.
 *
 * The same three tiers the host's settings form uses (`features/admin/settingsLabels.ts`)
 * so a host and their guest name one window alike, with one difference that matters
 * because this sentence is a promise to the guest rather than a label for the host:
 * minutes are rounded **down**. Ninety seconds is "one minute" here, never "two" — a
 * notice that overstates a deadline is a delete button that stops working early.
 */
export const selfRemovalSentence = (seconds: number, text: UiText): string => {
  if (seconds < SECONDS_PER_MINUTE) return text.upload.noticeRemovalSeconds(seconds)
  if (seconds % SECONDS_PER_HOUR === 0) {
    return text.upload.noticeRemovalHours(seconds / SECONDS_PER_HOUR)
  }
  return text.upload.noticeRemovalMinutes(Math.floor(seconds / SECONDS_PER_MINUTE))
}

/**
 * The four answers, in the order the roadmap asks them: what happens to a photo, who sees
 * it, how long it is kept, and how to have it removed.
 *
 * **A fifth line, only when the server sent an operator** (roadmap G2-17 / P3-18): "Hébergé
 * par", then the name the operator configured. It is last because it answers none of the four
 * questions — it says who holds the photograph — and it is the operator's own word for
 * themselves, so it is printed as written and never translated. A notice with no operator is
 * the four sections it always was.
 *
 * "Ask the organiser" is always true — a moderator can delete any photo of their event — and the
 * last sentence points at the guest's own "delete everything I sent" (roadmap §5.2), which exists
 * on every event and so is stated unconditionally (it is also a clause of the notice's revision).
 */
export const noticeSections = (
  notice: PrivacyNoticeDto,
  text: UiText,
): readonly NoticeSection[] => {
  const copy = text.upload

  const removal =
    notice.selfRemovalSeconds === null
      ? [copy.noticeRemovalAskHost]
      : [selfRemovalSentence(notice.selfRemovalSeconds, text), copy.noticeRemovalOtherwise]
  // Always true, so said on every event: the button is on the guest's own page (roadmap §5.2).
  const erasure = copy.noticeErasure(copy.eraseOpen, copy.mine)

  // An event with a guestbook (spec 01): the same four questions, titled for photos *and* messages,
  // each with one sentence for a message. Nothing changes for an event without one.
  const withBook = notice.guestbook === true

  return [
    {
      term: withBook ? text.guestbook.noticeWhatHappens : copy.noticeWhatHappens,
      // Stated unconditionally: the ingest pipeline strips it on every event, so there
      // is no setting it could contradict.
      sentences: [
        copy.noticeMetadataStripped,
        copy.noticePublication[notice.publication],
        ...(withBook ? [text.guestbook.noticeMessagePublication[notice.publication]] : []),
      ],
    },
    {
      term: withBook ? text.guestbook.noticeWhoSees : copy.noticeWhoSees,
      sentences: [
        ...notice.audiences.map((audience) => copy.noticeAudiences[audience]),
        ...(withBook ? [text.guestbook.noticeMessageAudience] : []),
      ],
    },
    {
      term: withBook ? text.guestbook.noticeHowLong : copy.noticeHowLong,
      sentences: [
        notice.retentionDays === null
          ? copy.noticeRetentionNone
          : copy.noticeRetentionDays(notice.retentionDays),
        ...(withBook ? [text.guestbook.noticeMessageRetention] : []),
      ],
    },
    {
      term: withBook ? text.guestbook.noticeRemoval : copy.noticeRemoval,
      sentences: [...removal, ...(withBook ? [text.guestbook.noticeMessageRemoval] : []), erasure],
    },
    ...(notice.operator === undefined
      ? []
      : [{ term: text.about.operatorHostedBy, sentences: [notice.operator] }]),
  ]
}
