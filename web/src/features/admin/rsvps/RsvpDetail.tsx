import { Fragment } from 'react'
import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { Notice } from '../../../design-system/components/Notice'
import { Dialog } from '../../../design-system/components/Dialog'
import type { RsvpDto, RsvpFormDto } from '../../../lib/api/dto'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { answerTone, peopleDetail } from '../../../lib/rsvp/rsvpList'
import { receivedAt } from './receivedAt'
import styles from './RsvpDetail.module.css'

export interface RsvpDetailProps {
  /** The reply shown, or `null` while the drawer is shut. */
  readonly reply: RsvpDto | null
  readonly form: RsvpFormDto
  /** Read-only: an archived event keeps its replies but they are no longer changed. */
  readonly locked: boolean
  /** Why the last act on this reply failed, shown here because the confirmation that asked is shut. */
  readonly problem: string | null
  readonly onEdit: (reply: RsvpDto) => void
  readonly onDelete: (reply: RsvpDto) => void
  readonly onClose: () => void
}

/**
 * One reply in full (spec 30): who, what they answered, what else they said, where it came from, and
 * the two things a host does to it, change it or delete it. The detail is the **host's**: the diet
 * is health data, seen by the owner alone.
 */
export function RsvpDetail({
  reply,
  form,
  locked,
  problem,
  onEdit,
  onDelete,
  onClose,
}: RsvpDetailProps) {
  const text = useTranslations().rsvp.list
  const { locale } = useLocale()
  const answerName = {
    yes: text.answerYes,
    maybe: text.answerMaybe,
    no: text.answerNo,
    waitlist: text.answerWaitlist,
  } as const
  const sourceName = {
    open: text.sourceOpen,
    host: text.sourceHost,
    household: text.sourceHousehold,
  } as const

  return (
    <Dialog
      open={reply !== null}
      title={reply?.name ?? ''}
      onClose={onClose}
      footer={
        reply === null ? null : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {text.closeDetail}
            </Button>
            {/* Erasing stays possible on an archived event: the right to erase does not end with it. */}
            <Button variant="danger" onClick={() => onDelete(reply)}>
              {text.remove}
            </Button>
            <Button variant="primary" disabled={locked} onClick={() => onEdit(reply)}>
              {text.edit}
            </Button>
          </>
        )
      }
    >
      {reply === null ? null : (
        <div className={styles['body']}>
          <p>
            <Badge tone={answerTone(reply.answer)}>{answerName[reply.answer]}</Badge>
          </p>
          <dl className={styles['list']}>
            {form.partySize.enabled && reply.answer !== 'no' ? (
              <>
                <dt>{text.detailPeople}</dt>
                <dd>{peopleDetail(reply, text)}</dd>
              </>
            ) : null}
            {reply.details.showName ? (
              <>
                <dt>{text.detailShowName}</dt>
                <dd>{text.detailYes}</dd>
              </>
            ) : null}
            {reply.details.companions.every((name) => name === '') ? null : (
              <>
                <dt>{text.detailCompanions}</dt>
                <dd>{reply.details.companions.filter((name) => name !== '').join(', ')}</dd>
              </>
            )}
            {reply.details.meals.every((meal) => meal === '') ? null : (
              <>
                <dt>{text.detailMeals}</dt>
                <dd>{reply.details.meals.filter((meal) => meal !== '').join(', ')}</dd>
              </>
            )}
            {reply.diet === null ? null : (
              <>
                <dt>{text.detailDiet}</dt>
                <dd>{reply.diet}</dd>
              </>
            )}
            {/* Every answer given, a question removed since included, under the label it was given with. */}
            {reply.details.answers
              .filter((answer) => answer.value !== '')
              .map((answer) => (
                <Fragment key={answer.questionId}>
                  <dt>{answer.label}</dt>
                  <dd>{answer.value}</dd>
                </Fragment>
              ))}
            {reply.message === null ? null : (
              <>
                <dt>{text.detailMessage}</dt>
                <dd>{reply.message}</dd>
              </>
            )}
            <dt>{text.detailReceived}</dt>
            <dd>
              {text.receivedVia(receivedAt(reply.updatedAt, locale), sourceName[reply.source])}
            </dd>
          </dl>
          {problem === null ? null : (
            <Notice tone="danger" variant="boxed" role="alert">
              {problem}
            </Notice>
          )}
          <p className={styles['note']}>{text.deleteNote}</p>
        </div>
      )}
    </Dialog>
  )
}
