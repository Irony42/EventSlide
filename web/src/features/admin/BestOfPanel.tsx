import { useState } from 'react'
import { Async } from '../../design-system/components/Async'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { useToast } from '../../design-system/components/useToast'
import { useApi } from '../../app/useApi'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { useBestOf, usePreselectHighlights } from './hooks/useBestOf'
import styles from './BestOfPanel.module.css'

/** How many photographs "pre-select the most liked" stars. A product default, shown in the answer. */
const PRESELECT_LIMIT = 20

export interface BestOfPanelProps {
  readonly slug: string
  /** Whether the event can still be moderated: starring is a moderation decision. */
  readonly canStar: boolean
}

/**
 * The host's best-of (spec 08, step 1): the favourites' count, the pre-selection from the
 * reactions, and the ZIP of the favourites.
 *
 * Renders nothing for a server that does not know the routes. The count is the server's: the
 * panel states no rule, and the ZIP button is disabled at zero because the server would answer
 * `highlight.empty` to it.
 */
export function BestOfPanel({ slug, canStar }: BestOfPanelProps) {
  const t = useTranslations()
  const api = useApi()
  const toast = useToast()
  const best = useBestOf(slug)
  const preselect = usePreselectHighlights()
  const [announcement, setAnnouncement] = useState('')

  if (best.data === 'unsupported') return null
  const count = best.data?.count ?? 0

  const runPreselect = () => {
    void preselect.run('preselect', slug, PRESELECT_LIMIT).then((result) => {
      if (!result.ok) {
        toast.show(result.message, { tone: 'danger' })
        return
      }
      setAnnouncement(
        result.value.added === 0
          ? t.admin.bestOfPreselectNothing
          : t.admin.bestOfPreselected(PRESELECT_LIMIT),
      )
      best.reload()
    })
  }

  return (
    <Card as="h2" title={t.admin.bestOf} subtitle={t.admin.bestOfHint}>
      <Async state={best} as="h3">
        {() => (
          <p className={count === 0 ? styles['none'] : styles['count']}>
            {count === 0 ? t.admin.bestOfNone : t.admin.bestOfCount(count)}
          </p>
        )}
      </Async>

      <div className={styles['actions']}>
        {canStar ? (
          <Button variant="secondary" loading={preselect.busy} onClick={runPreselect}>
            {t.admin.bestOfPreselect}
          </Button>
        ) : null}
        {count === 0 ? (
          <Button variant="primary" disabled>
            {t.admin.bestOfDownload}
          </Button>
        ) : (
          <a className={styles['download']} href={api.bestOfUrl(slug)} download>
            {t.admin.bestOfDownload}
          </a>
        )}
      </div>

      {/* The answer of the pre-selection, announced without moving focus. */}
      <p className={styles['announcement']} role="status" aria-live="polite">
        {announcement}
      </p>
    </Card>
  )
}
