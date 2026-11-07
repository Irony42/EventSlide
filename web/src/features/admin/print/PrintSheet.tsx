import { useEffect, useRef, type CSSProperties } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { LocaleOverride } from '../../../lib/i18n/LocaleProvider'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { joinHost } from '../../../lib/joinHost'
import {
  PRINT_FORMAT_SPECS,
  LOGO_MAX_SHARE,
  QUIET_ZONE_MODULES,
  qrLevelOf,
  totalModulesOf,
  type PrintFormat,
  type PrintInk,
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
  /** `black` is the safest; `event` wears the event's accent hue, darkened (spec 02, PR 2). */
  readonly ink: PrintInk
  /** The hue of the event's theme: the one value a theme moves. */
  readonly accentHue: number
  /** The event's logo, drawn at the centre of the QR (level H); `null` for the plain code. */
  readonly logoUrl?: string | null
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
  ink,
  accentHue,
  logoUrl = null,
  onQrModules,
}: PrintSheetProps) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onQrModules?.(totalModulesOf(root.current?.querySelector('svg') ?? null))
  }, [joinUrl, format, logoUrl, onQrModules])

  return (
    <div
      ref={root}
      className={styles['sheet']}
      data-format={format}
      data-ink={ink}
      lang={locale}
      style={{ '--accent-hue': String(accentHue) } as CSSProperties}
    >
      <LocaleOverride locale={locale}>
        {Array.from({ length: PRINT_FORMAT_SPECS[format].perSheet }, (_, index) => (
          <Card
            key={index}
            eventName={eventName}
            joinUrl={joinUrl}
            joinCode={joinCode}
            logoUrl={logoUrl}
          />
        ))}
      </LocaleOverride>
    </div>
  )
}

/** Drawing units of the SVG; the stylesheet scales it, so only the logo's share matters. */
const QR_SIZE = 100

/** Centred, cleared to the module grid so no module is half-hidden, at most 20 % of the side. */
const logoSettings = (src: string) => ({
  src,
  width: QR_SIZE * LOGO_MAX_SHARE,
  height: QR_SIZE * LOGO_MAX_SHARE,
  excavate: true,
})

function Card({
  eventName,
  joinUrl,
  joinCode,
  logoUrl = null,
}: Pick<PrintSheetProps, 'eventName' | 'joinUrl' | 'joinCode' | 'logoUrl'>) {
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
          level={qrLevelOf(logoUrl !== null)}
          size={QR_SIZE}
          {...(logoUrl === null ? {} : { imageSettings: logoSettings(logoUrl) })}
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
