import { useId, type ChangeEvent } from 'react'
import { fr } from '../../../lib/i18n/fr'
import styles from './PhotoPicker.module.css'

/**
 * The two ways a guest gets a photo into the queue: the library, and the camera.
 *
 * Both are `<input type="file">` with the real element left in the tab order and
 * merely made transparent over its label, so Tab reaches it and Enter opens the
 * picker. A `<div onClick>` that called `input.click()` — 1.0's approach — is
 * unreachable by keyboard and invisible to a screen reader.
 *
 * `capture="environment"` on the second one is what lets a guest shoot without
 * leaving the page. Without it they leave for the camera app, come back to a reloaded
 * page, and the queue is gone.
 */

export interface PhotoPickerProps {
  readonly onPick: (files: readonly File[]) => void
}

export function PhotoPicker({ onPick }: PhotoPickerProps) {
  const libraryId = useId()
  const cameraId = useId()

  const handle = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    // Cleared, so picking the same photo again still fires a change event. Otherwise a
    // guest who removed a photo by mistake cannot re-select it.
    event.target.value = ''
    if (files.length > 0) onPick(files)
  }

  return (
    <div className={styles['picker']}>
      <label className={`${styles['action']} ${styles['library']}`} htmlFor={libraryId}>
        <span>{fr.upload.addPhotos}</span>
        <input
          id={libraryId}
          className={styles['input']}
          data-testid="photo-input"
          type="file"
          accept="image/*"
          multiple
          onChange={handle}
        />
      </label>

      <label className={styles['action']} htmlFor={cameraId}>
        <span>{fr.upload.takePhoto}</span>
        <input
          id={cameraId}
          className={styles['input']}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handle}
        />
      </label>
    </div>
  )
}
