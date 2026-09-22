import { Badge } from '../../../design-system/components/Badge'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { statusLabel, statusTone } from '../eventLifecycle'
import type { EventStatus } from '../../../lib/api/dto'

export interface EventStatusBadgeProps {
  readonly status: EventStatus
}

/**
 * The event's state, as a word.
 *
 * `Badge` pairs the tone with its glyph, so a host who cannot tell the green from the
 * grey under venue lighting still reads "En cours".
 */
export function EventStatusBadge({ status }: EventStatusBadgeProps) {
  const t = useTranslations()

  return <Badge tone={statusTone(status)}>{statusLabel(status, t)}</Badge>
}
