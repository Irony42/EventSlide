import { Button } from '../../../design-system/components/Button'
import { Notice } from '../../../design-system/components/Notice'
import { photoAlt } from '../../../lib/photoAlt'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { usePhotoSave, type SaveRefusal } from '../hooks/usePhotoSave'
import type { WallItemDto } from '../../../lib/api/dto'
import styles from './SaveButton.module.css'

export interface SaveButtonProps {
  readonly slug: string
  readonly item: WallItemDto
  /** A refusal that concerns the whole feed, not this photograph: the page acts on it. */
  readonly onRefused: (reason: SaveRefusal) => void
  /** `true` the first time on this device, so the help line is said once and not under every photograph. */
  readonly claimHelp: () => boolean
}

/**
 * "Enregistrer", under a photograph of the evening that is somebody else's (spec 24).
 *
 * Only ever mounted when the host's switch is on as the wall last said, the guest's access
 * stands, the list of the guest's own photographs has loaded, and the photograph is a
 * photograph and not theirs — the page decides all four, so a button that is not wanted asks the
 * server nothing. The server decides them again at the tap, and the answer is spoken here or by
 * the page.
 *
 * **A word, not a pictogram, and a name that says which photograph.** Twelve buttons that are
 * all called "Enregistrer" are twelve identical stops for a screen reader; the accessible name
 * is the visible word followed by the photograph's own description. A failure of this
 * photograph is a `role="alert"` under it, because the guest is waiting on it; the single line
 * after a real download is a polite `status`. Nothing else announces anything.
 */
export function SaveButton({ slug, item, onRefused, claimHelp }: SaveButtonProps) {
  const t = useTranslations()
  const save = usePhotoSave({ slug, photoId: item.id, onRefused, claimHelp })

  const busy = save.phase === 'busy'
  const label = busy ? t.feed.saving : save.phase === 'ready' ? t.feed.saveReady : t.app.save

  return (
    <div className={styles['root']}>
      <Button
        variant="secondary"
        className={styles['button']}
        loading={busy}
        disabled={save.disabled && !busy}
        aria-label={t.feed.saveNamed(label, photoAlt(item, t))}
        onClick={save.press}
      >
        {label}
      </Button>

      {save.help === null ? null : (
        <p className={styles['help']}>
          {save.help === 'sheet' ? t.feed.saveHelpSheet : t.feed.saveHelpFiles}
        </p>
      )}

      {save.error === null ? null : (
        <Notice tone="danger" variant="inline" role="alert">
          {save.error}
        </Notice>
      )}

      {save.downloaded ? (
        <Notice tone="success" variant="inline" role="status">
          {t.feed.saveDownloaded}
        </Notice>
      ) : null}
    </div>
  )
}
