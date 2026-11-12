import { useState, type ReactNode, type RefObject } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { Dialog } from '../../../design-system/components/Dialog'
import { useToast } from '../../../design-system/components/useToast'
import { copyToClipboard } from '../../../lib/clipboard'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { EventActionIcon } from './EventActionIcon'
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
  /** Lets a control elsewhere on the page take the host to this card (the new-code toast). */
  readonly titleRef?: RefObject<HTMLHeadingElement | null>
  /** Links and buttons under the main actions (the table cards, a new code); hidden on paper. */
  readonly extraActions?: ReactNode
}

/** The QR itself, on its light plate: dark modules on a light field, or no phone reads it. */
function QrPlate({
  joinUrl,
  label,
  large = false,
}: {
  readonly joinUrl: string
  readonly label: string
  readonly large?: boolean
}) {
  return (
    // The accessible name lives on the wrapper: a QR code is a picture of a link, and role="img"
    // is what stops a screen reader walking a thousand <path>s.
    <div
      className={styles['plate']}
      data-size={large ? 'large' : 'small'}
      role="img"
      aria-label={label}
    >
      <QRCodeSVG
        className={styles['qr']}
        value={joinUrl}
        // Both colours are inherited from the plate, which is styled from tokens.
        bgColor="transparent"
        fgColor="currentColor"
        // A printed card gets handled, folded and photographed at an angle; M recovers from
        // about 15% damage where the default L gives up at 7%.
        level="M"
        // The quiet zone is the plate's padding, so it scales with the card.
        marginSize={0}
      />
    </div>
  )
}

/**
 * How a guest gets in: the code, the link and the QR, on one compact card beside the
 * "Maintenant" card (the host and the moderator, on the event page).
 *
 * The QR used to fill half the page, which is the size of a sheet of paper and not of anything a
 * host does with it on screen. On screen it is small, with the code large enough to read out and
 * the link one press from the clipboard; "Afficher en grand" puts it full size for the guest
 * standing at the laptop; and **on paper** the card is what prints, at the size a table needs
 * (the print rules below), with the event's name and the sentence that tells a guest what to do.
 *
 * Inline SVG, no remote image: the CSP forbids a third-party QR service and a venue's Wi-Fi
 * would drop it anyway — and the code would then be missing from the one artefact that has to
 * work on paper.
 */
export function EventQrCard({
  eventName,
  joinCode,
  joinUrl,
  titleRef,
  extraActions,
}: EventQrCardProps) {
  const t = useTranslations()
  const toast = useToast()
  const [enlarged, setEnlarged] = useState(false)

  const handlePrint = () => {
    // Some in-app browsers ship no `print()` at all; a guard is cheaper than a click that throws.
    if (typeof window.print === 'function') window.print()
  }

  const copyLink = () => {
    // A browser that refuses the clipboard (or has none, on a plain-HTTP address) costs the host
    // a selection by hand, and is told so; the link is on the card either way.
    void copyToClipboard(joinUrl).then((copied) =>
      copied
        ? toast.show(t.admin.joinLinkCopied, { tone: 'success' })
        : toast.show(t.admin.joinLinkCopyFailed, { tone: 'danger' }),
    )
  }

  return (
    <Card as="h2" title={t.admin.accessTitle} titleRef={titleRef}>
      <div className={styles['printable']}>
        {/* On paper only: on screen the page's own heading already names the event. */}
        <p className={styles['eventName']}>{eventName}</p>
        <QrPlate joinUrl={joinUrl} label={t.admin.qrAlt(eventName)} />
        <p className={styles['prompt']}>{t.admin.qrScanPrompt}</p>
        {/* The guest's join page names it with the same words, so what is said aloud matches. */}
        <p className={styles['codeLabel']}>{t.admin.joinCode}</p>
        <p className={styles['code']}>{joinCode}</p>
      </div>
      <p className={styles['url']}>
        <span className={styles['urlLabel']}>{t.admin.joinLink}</span>{' '}
        <a href={joinUrl}>{joinUrl}</a>
      </p>
      <div className={styles['actions']}>
        <Button size="sm" icon={<EventActionIcon glyph="copy" />} onClick={copyLink}>
          {t.admin.copyJoinLink}
        </Button>
        <Button size="sm" icon={<EventActionIcon glyph="print" />} onClick={handlePrint}>
          {t.admin.printQr}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<EventActionIcon glyph="expand" />}
          onClick={() => setEnlarged(true)}
          aria-haspopup="dialog"
        >
          {t.admin.qrEnlarge}
        </Button>
      </div>
      {extraActions === undefined ? null : <div className={styles['extra']}>{extraActions}</div>}

      <Dialog
        open={enlarged}
        title={eventName}
        description={t.admin.qrEnlargedHint}
        onClose={() => setEnlarged(false)}
        className={styles['enlarged']}
        footer={
          <Button variant="primary" onClick={() => setEnlarged(false)}>
            {t.app.close}
          </Button>
        }
      >
        <div className={styles['enlargedBody']}>
          <QrPlate joinUrl={joinUrl} label={t.admin.qrAlt(eventName)} large />
          <p className={styles['enlargedCode']}>{joinCode}</p>
        </div>
      </Dialog>
    </Card>
  )
}
