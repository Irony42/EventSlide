import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { accentNameFor } from '../../../design-system/eventTheme'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import styles from './AppearanceRow.module.css'
import type { EventSettingsDto } from '../../../lib/api/dto'

export interface AppearanceRowProps {
  readonly settings: EventSettingsDto
  /** Where the appearance page is. */
  readonly to: string
}

/**
 * What stays of the « Apparence » section on the settings page: one line saying what the event wears,
 * and the way to the page that changes it (`/appearance`).
 *
 * Surface: the host's laptop, before the event.
 *
 * It keeps the section's old anchor, `#look`, so a link or a bookmark written before the page moved
 * still lands here, scrolled into view, instead of on nothing.
 */
export function AppearanceRow({ settings, to }: AppearanceRowProps) {
  const t = useTranslations()
  const location = useLocation()
  const row = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (location.hash === '#look') row.current?.scrollIntoView?.({ block: 'center' })
  }, [location.hash])

  const accent = accentNameFor(settings.theme.accentHue)
  const summary = [
    t.admin.themeAmbianceNames[settings.theme.ambiance],
    // « De l'ambiance » is the colour of nobody in particular: it is not worth a word here.
    ...(accent === 'violet'
      ? []
      : [accent === null ? `${settings.theme.accentHue}°` : t.admin.themeAccentNames[accent]]),
    settings.brand?.logoUrl ? t.admin.appearance.rowWithLogo : t.admin.appearance.rowWithoutLogo,
  ].join(' · ')

  return (
    <section id="look" ref={row} className={styles['row']} aria-labelledby="look-title">
      <div className={styles['text']}>
        <h2 id="look-title" className={styles['title']}>
          {t.admin.appearance.title}
        </h2>
        <p className={styles['summary']}>{summary}</p>
      </div>
      <Link className={styles['edit']} to={to} aria-label={t.admin.appearance.rowEditLabel}>
        {t.admin.appearance.rowEdit}
        <span className={styles['chevron']} aria-hidden="true" />
      </Link>
    </section>
  )
}
