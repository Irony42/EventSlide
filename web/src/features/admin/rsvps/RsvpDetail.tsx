import { Fragment, useState } from 'react'
import { Badge } from '../../../design-system/components/Badge'
import { Button } from '../../../design-system/components/Button'
import { Notice } from '../../../design-system/components/Notice'
import { Dialog } from '../../../design-system/components/Dialog'
import { SelectField } from '../../../design-system/components/SelectField'
import type { HouseholdDto, RsvpDto, RsvpFormDto } from '../../../lib/api/dto'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { fileableHouseholds } from '../../../lib/rsvp/households'
import { momentsLabel } from '../../../lib/rsvp/rsvpCaterer'
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
  /** The host's guest list (lot 3): empty while there is none, and the section stays out. */
  readonly households: readonly HouseholdDto[]
  /** Files the reply under a household, or detaches it with `null`. */
  readonly onFile: (reply: RsvpDto, householdId: string | null) => void
  /** Promotes a waiting-list reply to a yes: the host decides, the places do not hold them back. */
  readonly onPromote: (reply: RsvpDto) => void
  /** The capacity and the people already coming: a promotion past it asks once more. */
  readonly capacity: number | null
  readonly yesPeople: number
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
  households,
  onFile,
  onPromote,
  capacity,
  yesPeople,
  onEdit,
  onDelete,
  onClose,
}: RsvpDetailProps) {
  const text = useTranslations().rsvp.list
  const { locale } = useLocale()
  // The household chosen to file the reply under, per reply: a change of reply starts afresh.
  /** The promotion past the capacity was asked once: the next click confirms it. */
  const [confirming, setConfirming] = useState<string | null>(null)
  const [chosen, setChosen] = useState<{ readonly of: string; readonly id: string } | null>(null)
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
            {reply.answer === 'waitlist' ? (
              <Button
                variant="secondary"
                disabled={locked}
                onClick={() => {
                  if (
                    capacity !== null &&
                    yesPeople + reply.adults + reply.kids > capacity &&
                    confirming !== reply.id
                  ) {
                    setConfirming(reply.id)
                  } else {
                    setConfirming(null)
                    onPromote(reply)
                  }
                }}
              >
                {confirming === reply.id ? text.promoteAnyway : text.promote}
              </Button>
            ) : null}
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
          {reply.answer === 'waitlist' ? <p>{text.detailWaitlistHint}</p> : null}
          {reply.answer === 'waitlist' && capacity !== null && confirming === reply.id ? (
            <p role="alert">{text.promoteOver(capacity)}</p>
          ) : null}
          <dl className={styles['list']}>
            {form.partySize.enabled && reply.answer !== 'no' ? (
              <>
                <dt>{text.detailPeople}</dt>
                <dd>{peopleDetail(reply, text)}</dd>
              </>
            ) : null}
            {momentsLabel(reply, form) === '' ? null : (
              <>
                <dt>{text.detailMoments}</dt>
                <dd>{momentsLabel(reply, form)}</dd>
              </>
            )}
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
          {households.length === 0 ? null : (
            <Filing
              reply={reply}
              households={households}
              chosen={chosen?.of === reply.id ? chosen.id : ''}
              onChoose={(id) => setChosen({ of: reply.id, id })}
              onFile={onFile}
              locked={locked}
            />
          )}
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

/**
 * "Associer à un foyer" (spec 30, lot 3): the host files a reply under a household of the list that
 * has no reply yet (a guest who answered on the common link), or detaches it. The household's name
 * is the host's own typing, shown as it is.
 */
function Filing({
  reply,
  households,
  chosen,
  onChoose,
  onFile,
  locked,
}: {
  readonly reply: RsvpDto
  readonly households: readonly HouseholdDto[]
  readonly chosen: string
  readonly onChoose: (id: string) => void
  readonly onFile: (reply: RsvpDto, householdId: string | null) => void
  readonly locked: boolean
}) {
  const text = useTranslations().rsvp.list
  const filedUnder = households.find((household) => household.id === reply.householdId) ?? null
  const options = fileableHouseholds(households, reply)
  return (
    <div className={styles['filing']}>
      {filedUnder === null ? (
        <>
          <SelectField
            label={text.detailHousehold}
            hint={text.detailHouseholdHint}
            value={chosen}
            disabled={locked}
            options={[
              { value: '', label: text.detailHouseholdNone },
              ...options.map((household) => ({ value: household.id, label: household.name })),
            ]}
            onChange={onChoose}
          />
          <Button
            size="sm"
            disabled={locked || chosen === ''}
            onClick={() => onFile(reply, chosen)}
          >
            {text.detailHouseholdFile}
          </Button>
        </>
      ) : (
        <>
          <p>
            <b>{text.detailHousehold}</b> {filedUnder.name}
          </p>
          <Button size="sm" disabled={locked} onClick={() => onFile(reply, null)}>
            {text.detailHouseholdUnfile}
          </Button>
        </>
      )}
    </div>
  )
}
