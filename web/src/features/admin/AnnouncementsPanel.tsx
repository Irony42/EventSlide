import { Card } from '../../design-system/components/Card'
import { useToast } from '../../design-system/components/useToast'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { AnnouncementControls } from '../../app/AnnouncementControls'

export interface AnnouncementsPanelProps {
  readonly slug: string
  readonly live: boolean
  /** The event's scheduled opening, when it has one: it decides which night a time like "00:30" means. */
  readonly opensAt: string | null
}

/** The event page's panel: the controls in a card, refusals as toasts. Any moderator's (spec 21). */
export function AnnouncementsPanel({ slug, live, opensAt }: AnnouncementsPanelProps) {
  const t = useTranslations()
  const toast = useToast()

  return (
    <Card as="h2" title={t.announcement.title}>
      <AnnouncementControls
        slug={slug}
        live={live}
        opensAt={opensAt}
        onFailure={(message) => {
          if (message !== null) toast.show(message, { tone: 'danger' })
        }}
      />
    </Card>
  )
}
