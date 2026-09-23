import { Dialog } from '../../../design-system/components/Dialog'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { GalleryPhotoDto } from '../../../lib/api/dto'
import styles from '../GalleryPage.module.css'

export interface GalleryViewerProps {
  /** The photograph open in the viewer, or `null` when it is closed. */
  readonly photo: GalleryPhotoDto | null
  /** One-based, as the guest counts. */
  readonly position: number
  readonly total: number
  readonly onClose: () => void
}

/**
 * One photograph, larger, with the thing a guest came for: the full-resolution download.
 *
 * The download is a plain link with `download`, not a fetch. The file is a camera's worth
 * of pixels, and the browser's own download manager is the right tool for it — buffering it
 * through JavaScript on a phone is how a tab runs out of memory halfway through. The server
 * sends it as an attachment under a name it chose, so what lands on the phone is the
 * original and never this page.
 *
 * A clip shows its poster here and downloads as its transcode: the gallery is for keeping
 * the evening, not for watching it in a dialog.
 */
export function GalleryViewer({ photo, position, total, onClose }: GalleryViewerProps) {
  const t = useTranslations()
  if (photo === null) return null

  const alt = photo.caption ?? t.gallery.photoAlt(position)

  return (
    <Dialog
      open
      title={t.gallery.viewerTitle(position, total)}
      onClose={onClose}
      footer={
        <a className={styles['download']} href={photo.downloadUrl} download>
          {photo.kind === 'clip' ? t.gallery.downloadClip : t.gallery.download}
        </a>
      }
    >
      <figure className={styles['figure']}>
        <img
          className={styles['large']}
          src={photo.viewUrl}
          alt={alt}
          width={photo.width}
          height={photo.height}
        />
        {/* Content: the guest's own words, as they were on the wall. */}
        {photo.caption === null ? null : (
          <figcaption className={styles['caption']}>{photo.caption}</figcaption>
        )}
      </figure>
    </Dialog>
  )
}
