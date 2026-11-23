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
      <table className={styles['table']}>
        <thead>
          <tr>
            <th scope="col">{text.colName}</th>
            <th scope="col">{text.colAnswer}</th>
            {people ? <th scope="col">{text.colPeople}</th> : null}
            {form.diet ? <th scope="col">{text.colDiet}</th> : null}
            <th scope="col">{text.colMessage}</th>
            <th scope="col">{text.colReceived}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((reply) => (
            <tr key={reply.id}>
              <th scope="row" className={styles['name']}>
                <button type="button" className={styles['open']} onClick={() => onOpen(reply)}>
                  {reply.name}
                </button>
              </th>
              <td data-label={text.colAnswer}>
                <Badge tone={answerTone(reply.answer)}>{answerName[reply.answer]}</Badge>
              </td>
              {people ? <td data-label={text.colPeople}>{peopleCell(reply, text)}</td> : null}
              {form.diet ? (
                <td data-label={text.colDiet} className={styles['free']}>
                  {reply.diet ?? text.none}
                </td>
              ) : null}
              <td data-label={text.colMessage} className={styles['free']}>
                {reply.message ?? text.none}
              </td>
              <td data-label={text.colReceived} className={styles['when']}>
                {receivedAt(reply.updatedAt, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
