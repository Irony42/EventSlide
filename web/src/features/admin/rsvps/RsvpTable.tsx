import { Badge } from '../../../design-system/components/Badge'
import type { RsvpDto, RsvpFormDto } from '../../../lib/api/dto'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { answerTone, peopleCell } from '../../../lib/rsvp/rsvpList'
import { receivedAt } from './receivedAt'
import styles from './RsvpTable.module.css'

export interface RsvpTableProps {
  readonly rows: readonly RsvpDto[]
  /** The host's form: a column exists only for what it asks. */
  readonly form: RsvpFormDto
  readonly onOpen: (reply: RsvpDto) => void
}

/**
 * The replies as a table (spec 30), and **as cards below 768 px**: it is one table in the page, set
 * to a column of cards by the stylesheet (each cell carries its label), so a phone reads the same
 * words a laptop does and nothing is drawn twice. The name opens the detail; a row is not a button
 * of its own, so the keyboard has one stop per reply.
 */
export function RsvpTable({ rows, form, onOpen }: RsvpTableProps) {
  const text = useTranslations().rsvp.list
  const { locale } = useLocale()
  const answerName = {
    yes: text.answerYes,
    maybe: text.answerMaybe,
    no: text.answerNo,
    waitlist: text.answerWaitlist,
  } as const
  const people = form.partySize.enabled

  return (
    <div className={styles['wrap']}>
      {/* Explicit roles: the card layout sets the cells to blocks, which drops the native table semantics. */}
      <table className={styles['table']} role="table">
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">
              {text.colName}
            </th>
            <th scope="col" role="columnheader">
              {text.colAnswer}
            </th>
            {people ? (
              <th scope="col" role="columnheader">
                {text.colPeople}
              </th>
            ) : null}
            {form.moments.map((moment) => (
              <th key={moment.id} scope="col" role="columnheader">
                {moment.label}
              </th>
            ))}
            {form.companionNames ? (
              <th scope="col" role="columnheader">
                {text.colCompanions}
              </th>
            ) : null}
            {form.meals.enabled ? (
              <th scope="col" role="columnheader">
                {text.colMeals}
              </th>
            ) : null}
            {form.diet ? (
              <th scope="col" role="columnheader">
                {text.colDiet}
              </th>
            ) : null}
            {form.questions.map((question) => (
              <th key={question.id} scope="col" role="columnheader">
                {question.label}
              </th>
            ))}
            <th scope="col" role="columnheader">
              {text.colMessage}
            </th>
            <th scope="col" role="columnheader">
              {text.colReceived}
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((reply) => (
            <tr key={reply.id} role="row">
              <th scope="row" role="rowheader" className={styles['name']}>
                <button type="button" className={styles['open']} onClick={() => onOpen(reply)}>
                  {reply.name}
                </button>
              </th>
              <td role="cell" data-label={text.colAnswer}>
                <Badge tone={answerTone(reply.answer)}>{answerName[reply.answer]}</Badge>
              </td>
              {people ? (
                <td role="cell" data-label={text.colPeople}>
                  {peopleCell(reply, text)}
                </td>
              ) : null}
              {form.moments.map((moment) => (
                <td key={moment.id} role="cell" data-label={moment.label}>
                  {reply.answer !== 'no' && reply.details.moments.includes(moment.id)
                    ? text.detailYes
                    : text.none}
                </td>
              ))}
              {form.companionNames ? (
                <td role="cell" data-label={text.colCompanions} className={styles['free']}>
                  {reply.details.companions.filter((name) => name !== '').join(', ') || text.none}
                </td>
              ) : null}
              {form.meals.enabled ? (
                <td role="cell" data-label={text.colMeals} className={styles['free']}>
                  {reply.details.meals.filter((meal) => meal !== '').join(', ') || text.none}
                </td>
              ) : null}
              {form.diet ? (
                <td role="cell" data-label={text.colDiet} className={styles['free']}>
                  {reply.diet ?? text.none}
                </td>
              ) : null}
              {form.questions.map((question) => (
                <td
                  key={question.id}
                  role="cell"
                  data-label={question.label}
                  className={styles['free']}
                >
                  {reply.details.answers.find((answer) => answer.questionId === question.id)
                    ?.value || text.none}
                </td>
              ))}
              <td role="cell" data-label={text.colMessage} className={styles['free']}>
                {reply.message ?? text.none}
              </td>
              <td role="cell" data-label={text.colReceived} className={styles['when']}>
                {receivedAt(reply.updatedAt, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
