import { QRCodeSVG } from 'qrcode.react'
import { fr } from '../../../lib/i18n/fr'
import styles from './JoinQr.module.css'

export type JoinQrSize = 'md' | 'lg'

export interface JoinQrProps {
  readonly url: string
  /** `lg` fills the invitation on an empty wall; `md` is the corner reminder. */
  readonly size?: JoinQrSize
}

/**
 * The join QR, drawn as inline SVG.
 *
 * Never a remote image: the `helmet` CSP forbids a third-party URL, and a venue's
 * Wi-Fi drops exactly the kind of request that would leave the room looking at a
 * broken-image icon for the first twenty minutes of the party.
 */
export function JoinQr({ url, size = 'md' }: JoinQrProps) {
  return (
    <div className={`${styles['plate']} ${styles[size]}`}>
      <QRCodeSVG
        className={styles['code']}
        value={url}
        title={fr.wall.qrTitle}
        // The plate supplies the light field from a token and the modules inherit its
        // ink through `currentColor`, so no colour literal reaches this file.
        bgColor="transparent"
        fgColor="currentColor"
        // Four modules of quiet zone is what the specification requires. A phone held
        // up at three metres in a dark room gets one attempt before its owner gives up.
        marginSize={4}
        level="M"
      />
    </div>
  )
}
