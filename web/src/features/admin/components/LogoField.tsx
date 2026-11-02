import { useId, useState, type ChangeEvent } from 'react'
import { Button } from '../../../design-system/components/Button'
import { Notice } from '../../../design-system/components/Notice'
import { useToast } from '../../../design-system/components/useToast'
import { isEventLogoUrl } from '../../../lib/brand'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { EventDto } from '../../../lib/api/dto'
import { useRemoveEventLogo, useUploadEventLogo } from '../hooks/useEventActions'
import styles from './LogoField.module.css'

export interface LogoFieldProps {
  readonly slug: string
  /**
   * The logo the **server** holds, not the form's draft: the upload is its own request
   * and does not wait for "Enregistrer", so the preview has to be what is stored.
   */
  readonly logoUrl: string | null | undefined
  readonly disabled: boolean
  /** The event as the server answered, so the page replaces its copy and shows the new URL. */
  readonly onChanged: (event: EventDto) => void
}

/**
 * The event's logo (spec 03): see it, replace it, or take it down.
 *
 * Surface: **the host's laptop**, before the event. It serves the guest's phone and the room,
 * which are what show the logo, on a plaque that keeps it legible whatever it looks like.
 *
 * No rule lives here. Whether the file is an image, how large it may be, what is stripped from
 * it and who may send it are the server's, and its refusals are shown in the host's own
 * language by code. The control is a real `<input type="file">` under its label, as the guest
 * picker is, so a keyboard reaches it.
 */
export function LogoField({ slug, logoUrl, disabled, onChanged }: LogoFieldProps) {
  const t = useTranslations()
  const toast = useToast()
  const upload = useUploadEventLogo()
  const remove = useRemoveEventLogo()
  const [failure, setFailure] = useState<string | null>(null)
  const inputId = useId()

  const busy = upload.busy || remove.busy
  const closed = disabled
  // Validated before it is an `<img src>`, as every path this client is handed is.
  const present = isEventLogoUrl(logoUrl)

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
      toast.show(t.admin.logoSaved, { tone: 'success' })
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
      toast.show(t.admin.logoRemoved, { tone: 'success' })
    })
  }

  return (
    <fieldset className={styles['group']}>
      <legend className={styles['legend']}>{t.admin.logo}</legend>
      <p className={styles['hint']}>{t.admin.logoHint}</p>

      {present ? (
        <span className={styles['plaque']}>
          <img className={styles['preview']} src={logoUrl} alt={t.admin.logoPreviewAlt} />
        </span>
      ) : (
        <p className={styles['hint']}>{t.admin.logoNone}</p>
      )}

      <div className={styles['actions']}>
        <label className={styles['pick']} htmlFor={inputId}>
          <span>{present ? t.admin.logoReplace : t.admin.logoChoose}</span>
          <input
            id={inputId}
            className={styles['input']}
            data-testid="logo-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
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
            {t.admin.logoRemove}
          </Button>
        ) : null}
      </div>

      {/* One live region, mounted whatever the state, so the wait is announced when it starts. */}
      <p className={styles['busy']} role="status">
        {upload.busy ? t.admin.logoBusy : ''}
      </p>

      {failure === null ? null : (
        <Notice tone="danger" role="alert" variant="boxed">
          {failure}
        </Notice>
      )}
    </fieldset>
  )
}
