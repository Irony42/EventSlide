import { StatusIcon } from '../../../design-system/components/StatusIcon'
import { cx } from '../../../design-system/classNames'
import { formatBytes } from '../../../lib/format'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import type { CeilingMeterDto, ClientLimitsDto } from '../../../lib/api/dto'
import { bannerLevel, noticeableMeters, type ContactAction } from '../ceilingLevels'
import styles from './CeilingBanner.module.css'

export interface CeilingBannerProps {
  readonly limits: ClientLimitsDto
  /** Where "contact your operator" leads, or `null` when the box published no address. */
  readonly contact: ContactAction | null
}

/**
 * The banner over a client's ceilings (G2-16 / P3-17): shown on the dashboard and on the
 * new-event form when a ceiling is at ninety per cent or more of what the operator allows,
 * and again, louder, when it is reached.
 *
 * **It tells and does not enforce.** The server refuses what a ceiling forbids
 * (`client.ceilingReached`, `client.storageFull`), and this is only the warning that comes
 * before the refusal, so a host learns about the limit on Tuesday and not in front of the guests
 * on Saturday. Nothing renders below the line: a banner that is always there is one nobody
 * reads, so a client at 89 per cent sees nothing and one at 90 sees that meter alone.
 *
 * Surface: the host's laptop. The tone is carried by the border and the icon **and** the
 * words, never by colour alone.
 */
export function CeilingBanner({ limits, contact }: CeilingBannerProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  const level = bannerLevel(limits)

  if (level === null) return null

  const line = (meter: CeilingMeterDto): string => {
    switch (meter.kind) {
      case 'events':
        return t.clientSpace.eventsMeter(meter.used, meter.max)
      case 'eventsPerPeriod':
        return t.clientSpace.eventsPerPeriodMeter(meter.used, meter.max)
      case 'storage':
        return t.clientSpace.storageMeter(
          formatBytes(meter.used, locale),
          formatBytes(meter.max, locale),
        )
    }
  }

  return (
    <section
      className={cx(styles['banner'], styles[level])}
      aria-label={t.clientSpace.bannerLabel}
      data-level={level}
    >
      <p className={styles['title']}>
        <span className={styles['glyph']}>
          <StatusIcon tone={level === 'reached' ? 'danger' : 'warning'} />
        </span>
        {level === 'reached' ? t.clientSpace.reachedTitle : t.clientSpace.warningTitle}
      </p>
      <ul className={styles['lines']}>
        {noticeableMeters(limits).map((meter) => (
          <li key={meter.kind}>{line(meter)}</li>
        ))}
        {limits.ceilings.liveAllowed ? null : <li>{t.clientSpace.liveNotAllowed}</li>}
      </ul>
      <p className={styles['action']}>
        {contact === null ? (
          t.clientSpace.contactHint
        ) : (
          <a href={contact.href}>{t.clientSpace.contactAction}</a>
        )}
      </p>
    </section>
  )
}
