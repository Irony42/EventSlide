import { Notice } from '../../design-system/components/Notice'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { EventTakedownCard } from './components/EventTakedownCard'
import { PhotoTakedownCard } from './components/PhotoTakedownCard'
import styles from './TakedownPage.module.css'

/**
 * The operator's "remove without viewing" screen (`/admin/site/takedown`; launch review S5): find
 * an event or a photograph from what a report quoted, and take it down, put it back, hold its purge
 * or release it, each with a reason and a confirmation.
 *
 * Surface: the operator's laptop. It is the one screen of the console where the operator acts on
 * what a client's guests made, and it is built so that it cannot be shown it: ids, statuses and
 * instants in, ids, statuses and instants out. The introduction says so, and says the one thing that
 * is easy to get wrong: taking down does not stop the purge.
 */
export function TakedownPage() {
  const t = useTranslations()

  return (
    <div className={styles['page']}>
      <h1 className={styles['title']}>{t.site.takedownTitle}</h1>
      <Notice tone="neutral" variant="boxed">
        {t.site.takedownIntro}
      </Notice>
      <EventTakedownCard />
      <PhotoTakedownCard />
    </div>
  )
}
