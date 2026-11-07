import { Card } from '../../design-system/components/Card'
import { useToast } from '../../design-system/components/useToast'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { ChallengeControls } from '../../app/ChallengeControls'

export interface ChallengePanelProps {
  readonly slug: string
  readonly live: boolean
}

/** The console's panel: the controls in a card, refusals as toasts. */
export function ChallengePanel({ slug, live }: ChallengePanelProps) {
  const t = useTranslations()
  const toast = useToast()

  return (
    <Card as="h2" title={t.challenge.title}>
      <ChallengeControls
        slug={slug}
        live={live}
        onFailure={(message) => {
          if (message !== null) toast.show(message, { tone: 'danger' })
        }}
      />
    </Card>
  )
}
