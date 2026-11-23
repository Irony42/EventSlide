import { Button } from '../../../design-system/components/Button'
import type { RsvpFormDto, RsvpStatsDto } from '../../../lib/api/dto'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { plural } from '../../../lib/rsvp/rsvpTexts'
import styles from './RsvpCaterer.module.css'

export interface RsvpCatererProps {
  readonly stats: RsvpStatsDto
  readonly form: RsvpFormDto
  /** The file for the caterer: those who come, their menus and diets, no word. */
  readonly exportHref: string
  readonly onPrint: () => void
}

/**
 * "Traiteur" (spec 30, lot 2): what to tell whoever cooks, from the server's own figures: the
 * adults and the children who come, the "peut-être" apart (not counted), the menus, and the diets.
 * **The diets are health data, the host's alone**: this panel is in the owner's page, and the
 * file and the printed list are what the host chooses to hand over.
 */
export function RsvpCaterer({ stats, form, exportHref, onPrint }: RsvpCatererProps) {
  const text = useTranslations().rsvp.list
  const none = stats.yes.responses === 0

  return (
    <section className={styles['panel']} aria-labelledby="rsvp-caterer-title">
      <h2 id="rsvp-caterer-title">{text.catererTitle}</h2>
      <p className={styles['hint']}>{text.catererHint}</p>
      <dl className={styles['figures']}>
        <div>
          <dt>{text.catererAdults}</dt>
          <dd>{stats.yes.adults}</dd>
        </div>
        {form.kidsSeparate ? (
          <div>
            <dt>{text.catererKids}</dt>
            <dd>{stats.yes.kids}</dd>
          </div>
        ) : null}
        {form.maybe ? (
          <div>
            <dt>{text.catererMaybe}</dt>
            <dd>{stats.maybe.people}</dd>
          </div>
        ) : null}
      </dl>
      {form.meals.enabled ? (
        <div>
          <h3>{text.catererMeals}</h3>
          {stats.meals.length === 0 ? (
            <p className={styles['hint']}>{text.catererNoMeals}</p>
          ) : (
            <dl className={styles['list']}>
              {stats.meals.map((meal) => (
                <div key={meal.label}>
                  <dt>{meal.label}</dt>
                  <dd>{meal.count}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      ) : null}
      {form.diet ? (
        <div>
          <h3>{text.catererDiets}</h3>
          {stats.diets.length === 0 ? (
            <p className={styles['hint']}>{text.none}</p>
          ) : (
            <dl className={styles['list']}>
              {stats.diets.map((entry, index) => (
                <div key={`${entry.name}-${index}`}>
                  <dt>{entry.name}</dt>
                  <dd>{entry.diet}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className={styles['hint']}>{text.catererPrivate}</p>
        </div>
      ) : null}
      <div className={styles['actions']}>
        {none ? (
          <span className={styles['export']} aria-disabled="true">
            {text.catererExport}
          </span>
        ) : (
          <a className={styles['export']} href={exportHref} download>
            {text.catererExport}
          </a>
        )}
        <Button size="sm" variant="secondary" disabled={none} onClick={onPrint}>
          {text.catererPrint}
        </Button>
      </div>
      {none ? null : (
        <p className={styles['hint']}>
          {stats.yes.responses} {plural(stats.yes.responses, text.reply)}
        </p>
      )}
    </section>
  )
}
