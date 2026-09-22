import { QRCodeSVG } from 'qrcode.react'
import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import styles from './EventQrCard.module.css'

export interface EventQrCardProps {
  readonly eventName: string
  readonly joinCode: string
  /**
   * The server builds this from `PUBLIC_URL`. Never assembled here: 1.0's QR page
   * emitted `?partyname=` while the upload page read `?party`, so every guest silently
   * uploaded to the default event. One source for the link, and it is the server's.
   */
  readonly joinUrl: string
}

/**
 * The card a host prints and puts on the tables.
 *
 * Inline SVG, no remote image: the CSP forbids a third-party QR service and a venue's
 * Wi-Fi would drop it anyway — and the code would then be missing from the one artefact
 * that has to work on paper.
 */
export function EventQrCard({ eventName, joinCode, joinUrl }: EventQrCardProps) {
  const t = useTranslations()

  const handlePrint = () => {
    // Some in-app browsers ship no `print()` at all; a guard is cheaper than a click
    // that throws.
    if (typeof window.print === 'function') window.print()
  }

  return (
    <Card as="h2" title={t.admin.qrCode} subtitle={t.admin.qrCodeHint}>
      <div className={styles['printable']}>
        <p className={styles['eventName']}>{eventName}</p>
        {/*
          The accessible name lives on the wrapper: a QR code is a picture of a link,
          and role="img" is what stops a screen reader walking a thousand <path>s.
        */}
        <div className={styles['plate']} role="img" aria-label={t.admin.qrAlt(eventName)}>
          <QRCodeSVG
            className={styles['qr']}
            value={joinUrl}
            // Both colours are inherited from the plate, which is styled from tokens.
            bgColor="transparent"
            fgColor="currentColor"
            // A printed card gets handled, folded and photographed at an angle; M
            // recovers from about 15% damage where the default L gives up at 7%.
            level="M"
            // The quiet zone is the plate's padding, so it scales with the card.
            marginSize={0}
          />
        </div>
        <p className={styles['prompt']}>{t.admin.qrScanPrompt}</p>
        <p className={styles['code']}>{joinCode}</p>
      </div>
      <Button className={styles['printAction']} onClick={handlePrint}>
        {t.admin.printQr}
      </Button>
    </Card>
  )
}
