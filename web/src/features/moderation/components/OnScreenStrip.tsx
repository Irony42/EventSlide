import { useState } from 'react'
import { Button } from '../../../design-system/components/Button'
import { Dialog } from '../../../design-system/components/Dialog'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { ModerationPhotoDto } from '../../../lib/api/dto'
import styles from './OnScreenStrip.module.css'

/**
 * "Dernières photos à l'écran": the latest few published photos, one touch from coming off the wall.
 *
 * The phone console shows one waiting photo at a time and has no filter bar, so until MOD-2
 * a photo already on the wall could be taken down from the phone only if it was the host's
 * own last publication. At 23 h, with the room looking at a photo it should not be looking
 * at, that is the one thing the host needs and the one thing the phone could not do — the
 * way out was a link to a dense, keyboard-shaped grid at the foot of the page.
 *
 * Touching a thumbnail opens it, large, with exactly one action. A strip of buttons that
 * each took a photo off the wall on the first touch would be a strip a thumb scrolling past
 * it takes down photos with.
 */

export interface OnScreenStripProps {
  /** Photos on the wall, newest first. The strip shows what it is given and judges nothing. */
  readonly photos: readonly ModerationPhotoDto[]
  /** A decision is in flight: the one action waits, as the console's other buttons do. */
  readonly busy: boolean
  readonly onRemove: (photoId: string) => void
}

export function OnScreenStrip({ photos, busy, onRemove }: OnScreenStripProps) {
  const t = useTranslations()
  /**
   * By id, so a photo that leaves the wall while its viewer is open (another moderator
   * took it down) closes the viewer instead of leaving a button that acts on nothing.
   */
  const [openId, setOpenId] = useState<string | null>(null)
  const open = photos.find((photo) => photo.id === openId) ?? null

  const authorOf = (photo: ModerationPhotoDto) => photo.authorName ?? t.moderation.anonymousInName

  return (
    <section className={styles['strip']} aria-labelledby="on-screen-title">
      <h2 id="on-screen-title" className={styles['title']}>
        {t.mobileModeration.onScreenTitle}
      </h2>
      {photos.length === 0 ? (
        <p className={styles['hint']}>{t.mobileModeration.onScreenEmpty}</p>
      ) : (
        <>
          <p className={styles['hint']}>{t.mobileModeration.onScreenHint}</p>
          <ul className={styles['list']}>
            {photos.map((photo) => (
              <li key={photo.id}>
                <button
                  type="button"
                  className={styles['thumb']}
                  aria-label={t.mobileModeration.openOnScreen(authorOf(photo))}
                  onClick={() => setOpenId(photo.id)}
                >
                  <img
                    className={styles['image']}
                    src={photo.thumbUrl}
                    // The button names the photo; the picture is decoration inside it.
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <Dialog
        open={open !== null}
        title={open === null ? '' : t.moderation.photoOf(authorOf(open))}
        onClose={() => setOpenId(null)}
        footer={
          open === null ? null : (
            <Button
              variant="danger"
              size="lg"
              block
              loading={busy}
              aria-label={t.moderation.hidePhoto(authorOf(open))}
              onClick={() => {
                onRemove(open.id)
                setOpenId(null)
              }}
            >
              {t.moderation.hide}
            </Button>
          )
        }
      >
        {open === null ? null : (
          <img
            className={styles['large']}
            src={open.displayUrl}
            alt={
              open.caption === null
                ? t.moderation.photoAlt(authorOf(open))
                : t.moderation.photoAltWithCaption(open.caption, authorOf(open))
            }
            decoding="async"
          />
        )}
      </Dialog>
    </section>
  )
}
