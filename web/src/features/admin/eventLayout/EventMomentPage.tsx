import { useTranslations } from '../../../lib/i18n/useTranslations'
import { eventMenu, hasSettings, momentOf, type EventMoment } from './eventSections'
import { SectionLink } from './EventNav'
import { sectionFactsOf, useEventPage } from './useEventPage'
import styles from './EventMomentPage.module.css'

/**
 * One moment's subjects as a list (surface: the host and the moderator, mostly on a phone, where
 * each tab of the bar at the bottom opens one of these).
 *
 * Each row is the menu's entry with the line that says what is there, large enough for a thumb.
 * The settings close the « Préparer » list for the owner, since the phone has no menu to hold them.
 */
export function EventMomentPage({ moment }: { readonly moment: EventMoment }) {
  const t = useTranslations()
  const { event } = useEventPage()
  const group = eventMenu(sectionFactsOf(event)).find((candidate) => candidate.moment === moment)
  const sections = [
    ...(group?.sections ?? []),
    ...(moment === 'before' && hasSettings(event.role) ? (['settings'] as const) : []),
  ]

  return (
    <div className={styles['page']}>
      <header className={styles['header']}>
        <h1 className={styles['title']}>
          {t.eventMenu.moments[moment]}
          {momentOf(event.status) === moment ? (
            <span className={styles['now']}>{t.eventMenu.current}</span>
          ) : null}
        </h1>
        <p className={styles['intro']}>{t.eventMenu.momentIntros[moment]}</p>
      </header>
      <ul className={styles['list']}>
        {sections.map((section) => (
          <li key={section}>
            <SectionLink
              event={event}
              section={section}
              hint={t.eventMenu.hints[section]}
              className={styles['row']}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
