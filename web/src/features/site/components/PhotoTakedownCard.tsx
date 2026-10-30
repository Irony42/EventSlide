import { useCallback, useState, type FormEvent } from 'react'
import { useApi } from '../../../app/useApi'
import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { Field } from '../../../design-system/components/Field'
import { TextInput } from '../../../design-system/components/TextInput'
import type { SitePhotoStateDto } from '../../../lib/api/dto'
import { ApiError } from '../../../lib/http'
import { messageForError } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { TakedownRow } from './TakedownRow'
import styles from './TakedownCard.module.css'

/**
 * Finds a photograph from the id a report quotes, and takes it down or puts it back
 * (`GET /api/site/photos/:photoId`, then the take-down and restore routes).
 *
 * Surface: the operator's laptop. All that is shown is the id, the event it belongs to (an id) and
 * whether it is down: **never the photograph, a thumbnail, a caption or an address to either**,
 * because the server sends none and this card has nowhere to put one.
 */
export function PhotoTakedownCard() {
  const t = useTranslations()
  const api = useApi()
  const [text, setText] = useState('')
  const [found, setFound] = useState<SitePhotoStateDto | null>(null)
  const [missing, setMissing] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  const read = useCallback(
    (id: string) => {
      setFailure(null)
      setMissing(false)
      setSearching(true)
      return api.sitePhotoState(id).then(
        (state) => {
          setFound(state)
          setSearching(false)
        },
        (cause: unknown) => {
          setFound(null)
          if (cause instanceof ApiError && cause.code === 'photo.notFound') setMissing(true)
          else setFailure(messageForError(cause, t))
          setSearching(false)
        },
      )
    },
    [api, t],
  )

  const search = (event: FormEvent) => {
    event.preventDefault()
    const id = text.trim()
    if (id !== '') void read(id)
  }

  return (
    <Card as="h2" title={t.site.takedownPhotoTitle} subtitle={t.site.takedownPhotoIntro}>
      <form className={styles['form']} onSubmit={search}>
        <Field label={t.site.takedownPhotoLabel}>
          {(control) => (
            <TextInput
              {...control}
              name="photoId"
              variant="code"
              autoComplete="off"
              spellCheck={false}
              required
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          )}
        </Field>
        <div>
          <Button type="submit" variant="primary" loading={searching}>
            {t.site.takedownPhotoAction}
          </Button>
        </div>
      </form>
      {failure === null ? null : <p role="alert">{failure}</p>}
      {missing ? <p role="status">{t.site.takedownPhotoNone}</p> : null}
      {found === null ? null : (
        <ul className={styles['list']}>
          <TakedownRow
            heading={t.site.takedownPhotoHeading(found.id)}
            id={found.id}
            states={[
              found.takenDownAt === null
                ? { label: t.site.takedownStateUp, tone: 'success' }
                : { label: t.site.takedownStateDown, tone: 'danger' },
            ]}
            details={t.site.takedownPhotoOf(found.eventId)}
            buttons={[
              found.takenDownAt === null
                ? { op: 'photoDown', label: t.site.takedownPhotoDown }
                : { op: 'photoUp', label: t.site.takedownPhotoUp },
            ]}
            onDone={() => void read(found.id)}
          />
        </ul>
      )}
    </Card>
  )
}
