import { useId, useState, type ChangeEvent } from 'react'
import { Button } from '../../../design-system/components/Button'
import { Notice } from '../../../design-system/components/Notice'
import { useToast } from '../../../design-system/components/useToast'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { EventDto } from '../../../lib/api/dto'
import { useRemoveVenuePhoto, useUploadVenuePhoto } from '../hooks/useEventActions'
import styles from './VenuePhotoField.module.css'

export interface VenuePhotoFieldProps {
  readonly slug: string
  /**
   * The photograph the **server** holds, not the form's draft: the upload is its own request
   * and does not wait for "Enregistrer", so the preview has to be what is stored.
   */
  readonly groundUrl: string | null | undefined
  /**
   * The form carries an ambiance choice the host has not saved. The server judges an upload
   * against the **saved** ambiance, so until then the controls are closed and say why.
   */
  readonly ambianceUnsaved: boolean
  readonly disabled: boolean
  /** The event as the server answered, so the page replaces its copy and shows the new URL. */
  readonly onChanged: (event: EventDto) => void
}

/**
 * The host's own photograph of their venue, for an ambiance that photographs its ground
 * (ADR 0010, decision 8): see it, replace it, or take it down.
 *
 * Surface: **the host's laptop**, before the event. It serves the guest's phone and the room,
 * which are what show the photograph.
 *
 * No rule lives here. Whether the file is an image, how large it may be, what is stripped from
 * it and who may send it are the server's, and its refusals are shown in the host's own
 * language by code. The control is a real `<input type="file">` under its label, as the guest
 * picker is, so a keyboard reaches it.
 */
export function VenuePhotoField({
  slug,
  groundUrl,
  ambianceUnsaved,
  disabled,
  onChanged,
}: VenuePhotoFieldProps) {
  const t = useTranslations()
  const toast = useToast()
  const upload = useUploadVenuePhoto()
  const remove = useRemoveVenuePhoto()
  const [failure, setFailure] = useState<string | null>(null)
  const inputId = useId()

  const busy = upload.busy || remove.busy
  const closed = disabled || ambianceUnsaved
  const present = groundUrl !== null && groundUrl !== undefined

  const handlePick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Cleared, so choosing the same file again after a refusal still fires a change event.
    event.target.value = ''
    if (file === undefined) return

    setFailure(null)
    void upload.run('upload', slug, file).then((result) => {
      if (!result.ok) {
        setFailure(result.message)
        return
      }
      onChanged(result.value)
      toast.show(t.admin.venuePhotoSaved, { tone: 'success' })
    })
  }

  const handleRemove = () => {
    setFailure(null)
    void remove.run('remove', slug).then((result) => {
      if (!result.ok) {
        setFailure(result.message)
        return
      }
      onChanged(result.value)
      toast.show(t.admin.venuePhotoRemoved, { tone: 'success' })
    })
  }

  return (
    <fieldset className={styles['group']}>
      <legend className={styles['legend']}>{t.admin.venuePhoto}</legend>
      <p className={styles['hint']}>{t.admin.venuePhotoHint}</p>

      {present ? (
        <img className={styles['preview']} src={groundUrl} alt={t.admin.venuePhotoPreviewAlt} />
      ) : (
        <p className={styles['hint']}>{t.admin.venuePhotoDefault}</p>
      )}

      {ambianceUnsaved ? <p className={styles['hint']}>{t.admin.venuePhotoSaveFirst}</p> : null}

      <div className={styles['actions']}>
        <label className={styles['pick']} htmlFor={inputId}>
          <span>{present ? t.admin.venuePhotoReplace : t.admin.venuePhotoChoose}</span>
          <input
            id={inputId}
            className={styles['input']}
            data-testid="venue-photo-input"
            type="file"
            accept="image/*"
            disabled={closed || busy}
            onChange={handlePick}
          />
        </label>

        {present ? (
          <Button
            variant="ghost"
            loading={remove.busy}
            disabled={closed || upload.busy}
            onClick={handleRemove}
          >
            {t.admin.venuePhotoRemove}
          </Button>
        ) : null}
      </div>

      {/* One live region, mounted whatever the state, so the wait is announced when it starts. */}
      <p className={styles['busy']} role="status">
        {upload.busy ? t.admin.venuePhotoBusy : ''}
      </p>

      {failure === null ? null : (
        <Notice tone="danger" role="alert" variant="boxed">
          {failure}
        </Notice>
      )}
    </fieldset>
  )
}
