import { useEffect, useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { LocaleOverride } from '../../../lib/i18n/LocaleProvider'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { joinHost } from '../../wall/joinHost'
import {
  PRINT_FORMAT_SPECS,
  QUIET_ZONE_MODULES,
  totalModulesOf,
  type PrintFormat,
} from './printKit'
import styles from './PrintSheet.module.css'
import type { Locale } from '../../../lib/i18n/locale'

export interface PrintSheetProps {
  /** Content: printed as written, never translated. */
  readonly eventName: string
  /** The server's link, never recomposed (CLAUDE.md §9 trap 1). */
  readonly joinUrl: string
  readonly joinCode: string
  readonly format: PrintFormat
  /** The language of the evening, which is not necessarily the console's. */
  readonly locale: Locale
  /** Told the module count of the rendered QR (quiet zone included), once it is drawn. */
  readonly onQrModules?: (totalModules: number | null) => void
}

/**
 * The A4 sheet a host prints: one, two or four copies of the same card.
 *
 * Surface: the host's paper, never the room's wall. The ink is dark on white and never
 * inverted; the quiet zone is the SVG's own margin, not a fill.
 */
export function PrintSheet({
  eventName,
  joinUrl,
  joinCode,
  format,
  locale,
  onQrModules,
}: PrintSheetProps) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onQrModules?.(totalModulesOf(root.current?.querySelector('svg') ?? null))
  }, [joinUrl, format, onQrModules])

  return (
    <div ref={root} className={styles['sheet']} data-format={format} lang={locale}>
      <LocaleOverride locale={locale}>
        {Array.from({ length: PRINT_FORMAT_SPECS[format].perSheet }, (_, index) => (
          <Card key={index} eventName={eventName} joinUrl={joinUrl} joinCode={joinCode} />
        ))}
      </LocaleOverride>
    </div>
  )
}

function Card({
  eventName,
  joinUrl,
  joinCode,
}: Pick<PrintSheetProps, 'eventName' | 'joinUrl' | 'joinCode'>) {
  const t = useTranslations()
  const address = joinHost(joinUrl)
  return (
    <article className={styles['cell']}>
      <p className={styles['name']}>{eventName}</p>
      <h2 className={styles['title']}>{t.printKit.title}</h2>
      <div className={styles['qr']} role="img" aria-label={t.admin.qrAlt(eventName)}>
        <QRCodeSVG
          value={joinUrl}
          fgColor="currentColor"
          bgColor="transparent"
          level="M"
          marginSize={QUIET_ZONE_MODULES}
        />
      </div>
      <div className={styles['text']}>
        <ol className={styles['steps']}>
          <li>{t.printKit.step1}</li>
          <li>{t.printKit.step2}</li>
          <li>{t.printKit.step3}</li>
        </ol>
        <p className={styles['fallback']}>
          {address === null ? joinCode : t.printKit.fallback(joinCode, address)}
        </p>
      </div>
    </article>
  )
}
