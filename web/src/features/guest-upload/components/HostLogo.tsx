import { isEventLogoUrl } from '../../../lib/brand'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import styles from './HostLogo.module.css'

export interface HostLogoProps {
  /** `brand.logoUrl` from the server. Anything but the shape the server mints renders nothing. */
  readonly url: string | null | undefined
  readonly eventName: string
  /** `compact` on the upload screen, `wall` on the projector's empty wall. */
  readonly variant?: 'full' | 'compact' | 'wall'
}

/**
 * The host's logo (spec 03) on a plaque, contained and never cropped, so a logo with
 * transparency stays legible on any ambiance. Decorative-adjacent but named, for a screen
 * reader: "Logo de {event}". Nothing when there is none: the screen is then what it was.
 */
export function HostLogo({ url, eventName, variant = 'full' }: HostLogoProps) {
  const text = useTranslations()
  if (!isEventLogoUrl(url)) return null
  return (
    <span className={styles[variant]} data-testid="host-logo">
      <img
        className={styles['image']}
        src={url}
        alt={text.join.logoAlt(eventName)}
        decoding="async"
      />
    </span>
  )
}
