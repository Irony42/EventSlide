import { useEffect, useRef, type CSSProperties } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { LocaleOverride } from '../../../lib/i18n/LocaleProvider'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { joinHost } from '../../../lib/joinHost'
import { cardNameOf } from '../../../lib/rsvp/households'
import { PrintCard, type PrintCardInvitation, type PrintCardTexts } from './PrintCard'
import {
  PRINT_FORMAT_SPECS,
  LOGO_MAX_SHARE,
  QUIET_ZONE_MODULES,
  qrLevelOf,
  totalModulesOf,
  type PrintFormat,
  type PrintInk,
} from './printKit'
import type { PrintDesign } from '../../../lib/print/printDesigns'
import { useFitText } from './useFitText'
import styles from './PrintSheet.module.css'
import type { Locale } from '../../../lib/i18n/locale'

/**
 * One household's card (spec 30, lot 3, PR 12): its name replaces the card's eyebrow, and **its own
 * link** (`<invitation>#f=<token>`) is what the QR carries. The secret is in the fragment, so it is
 * in no log and no request; it is printed only inside the code, never as text.
 */
export interface PrintHouseholdCard {
  readonly id: string
  readonly name: string
  readonly url: string
}

export interface PrintSheetProps {
  /** Content: printed as written, never translated. */
  readonly eventName: string
  /** The server's link, never recomposed (CLAUDE.md §9 trap 1). */
  readonly joinUrl: string
  readonly joinCode: string
  readonly format: PrintFormat
  /** The language of the evening, which is not necessarily the console's. */
  readonly locale: Locale
  /** `black` is the safest; `event` wears the card's hue, darkened (spec 02, PR 2). */
  readonly ink: PrintInk
  /** The hue the darker and paler shades are drawn from (oklch degrees). */
  readonly accentHue: number
  /** The card's colour as CSS: the host's `#rrggbb`, or the event's accent. */
  readonly colour: string
  /** The event's logo, drawn at the centre of the QR (level H); `null` for the plain code. */
  readonly logoUrl?: string | null
  readonly design: PrintDesign
  /** The host's words with the defaults already filled in (spec 28). */
  readonly texts: PrintCardTexts
  readonly steps: boolean
  readonly photoUrl: string | null
  readonly focusX: number
  readonly focusY: number
  /** One card, drawn alone and big, for design work; the sheet with its cut marks otherwise. */
  readonly single?: boolean
  /** An invitation card (spec 29): the QR then leads to `joinUrl`, which is the invitation's link. */
  readonly invitation?: PrintCardInvitation | undefined
  /** Told the module count of the rendered QR (quiet zone included), once it is drawn. */
  readonly onQrModules?: (totalModules: number | null) => void
  /**
   * One card per household instead of the same card repeated (an invitation card only): as many
   * sheets as it takes, the last one short. The screen shows the first sheet, the paper all of them.
   */
  readonly households?: readonly PrintHouseholdCard[] | undefined
}

/**
 * The A4 sheet a host prints: four A6 cards, two A5 side by side on a landscape sheet, or one A4,
 * all in the design the host chose (spec 28).
 *
 * Surface: the host's paper, never the room's wall. The QR is dark on white and never inverted;
 * the quiet zone is the SVG's own margin, not a fill.
 */
export function PrintSheet({
  eventName,
  joinUrl,
  joinCode,
  format,
  locale,
  ink,
  accentHue,
  colour,
  logoUrl = null,
  design,
  texts,
  steps,
  photoUrl,
  focusX,
  focusY,
  invitation,
  single = false,
  onQrModules,
  households,
}: PrintSheetProps) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onQrModules?.(totalModulesOf(root.current?.querySelector('svg') ?? null))
  }, [joinUrl, format, logoUrl, design, single, onQrModules, households])

  useFitText(
    root,
    `${format}|${single}|${design}|${locale}|${JSON.stringify(texts)}|${steps}|${photoUrl === null}|${JSON.stringify(invitation ?? null)}|${JSON.stringify(households ?? null)}`,
  )

  // A card for each household: the sheets are laid one after the other, one page each on paper.
  if (households !== undefined && invitation !== undefined && !single) {
    const perSheet = PRINT_FORMAT_SPECS[format].perSheet
    const sheets = Array.from({ length: Math.ceil(households.length / perSheet) }, (_, page) =>
      households.slice(page * perSheet, (page + 1) * perSheet),
    )
    return (
      <div className={styles['stage']} ref={root}>
        {sheets.map((cards, page) => (
          <div
            key={cards[0]?.id ?? page}
            className={styles['sheet']}
            data-format={format}
            data-ink={ink}
            data-household-sheet=""
            lang={locale}
            style={{ '--accent-hue': String(accentHue), '--pd-color': colour } as CSSProperties}
          >
            <LocaleOverride locale={locale}>
              {cards.map((card) => (
                <div key={card.id} className={styles['cell']}>
                  <PrintCard
                    design={design}
                    texts={texts}
                    steps={steps}
                    photoUrl={photoUrl}
                    focusX={focusX}
                    focusY={focusY}
                    invitation={{ ...invitation, eyebrow: cardNameOf(card.name) }}
                    joinCode={joinCode}
                    address={joinHost(joinUrl)}
                    qr={<SheetQr eventName={eventName} joinUrl={card.url} logoUrl={logoUrl} />}
                  />
                </div>
              ))}
            </LocaleOverride>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={styles['stage']}>
      <div
        ref={root}
        className={styles['sheet']}
        data-format={format}
        data-ink={ink}
        {...(single ? { 'data-single': '' } : {})}
        lang={locale}
        style={{ '--accent-hue': String(accentHue), '--pd-color': colour } as CSSProperties}
      >
        <LocaleOverride locale={locale}>
          {Array.from({ length: single ? 1 : PRINT_FORMAT_SPECS[format].perSheet }, (_, index) => (
            <div key={index} className={styles['cell']}>
              <PrintCard
                design={design}
                texts={texts}
                steps={steps}
                photoUrl={photoUrl}
                focusX={focusX}
                focusY={focusY}
                invitation={invitation}
                joinCode={joinCode}
                address={joinHost(joinUrl)}
                qr={<SheetQr eventName={eventName} joinUrl={joinUrl} logoUrl={logoUrl} />}
              />
            </div>
          ))}
        </LocaleOverride>
      </div>
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

export function SheetQr({
  eventName,
  joinUrl,
  logoUrl,
}: {
  readonly eventName: string
  readonly joinUrl: string
  readonly logoUrl: string | null
}) {
  const t = useTranslations()
  return (
    <div role="img" aria-label={t.admin.qrAlt(eventName)}>
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
  )
}
