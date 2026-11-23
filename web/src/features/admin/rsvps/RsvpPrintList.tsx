import { createPortal } from 'react-dom'
import type { RsvpDto, RsvpFormDto, RsvpStatsDto } from '../../../lib/api/dto'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { companionsLabel, mealsLabel, printRowsOf } from '../../../lib/rsvp/rsvpCaterer'
import styles from './RsvpPrintList.module.css'

export interface RsvpPrintListProps {
  readonly eventName: string
  readonly rsvps: readonly RsvpDto[]
  readonly stats: RsvpStatsDto
  readonly form: RsvpFormDto
}

/** The guests who come, by name: how many, who comes along, what they eat, what they cannot. */
export function RsvpPrintList({ eventName, rsvps, stats, form }: RsvpPrintListProps) {
  const text = useTranslations().rsvp.list
  const rows = printRowsOf(rsvps)

  return createPortal(
    <section className={styles['sheet']} data-rsvp-print>
      <h1>{text.printTitle(eventName)}</h1>
      <p className={styles['note']}>{text.printConfidential}</p>
      <p>{text.printTotals(stats.yes.adults, stats.yes.kids)}</p>
      <table>
        <thead>
          <tr>
            <th scope="col">{text.colName}</th>
            <th scope="col">{text.colPeople}</th>
            {form.companionNames ? <th scope="col">{text.colCompanions}</th> : null}
            {form.meals.enabled ? <th scope="col">{text.colMeals}</th> : null}
            {form.diet ? <th scope="col">{text.colDiet}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((reply) => (
            <tr key={reply.id}>
              <th scope="row">{reply.name}</th>
              <td>{reply.adults + reply.kids}</td>
              {form.companionNames ? <td>{companionsLabel(reply)}</td> : null}
              {form.meals.enabled ? <td>{mealsLabel(reply.details.meals)}</td> : null}
              {form.diet ? <td>{reply.diet ?? ''}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </section>,
    document.body,
  )
}
