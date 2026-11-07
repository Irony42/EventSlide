import { useCallback, useRef, useState, type FormEvent } from 'react'
import { useApi } from '../../../lib/useApi'
import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { Field } from '../../../design-system/components/Field'
import { TextInput } from '../../../design-system/components/TextInput'
import type { SiteGuestbookStateDto } from '../../../lib/api/dto'
import { ApiError } from '../../../lib/http'
import { messageForError } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { TakedownRow } from './TakedownRow'
import styles from './TakedownCard.module.css'

/**
 * Finds a guestbook message from the id a report quotes, and takes it down or puts it back
 * (`GET /api/site/guestbook-entries/:entryId`, then the take-down and restore routes; spec 01).
 *
 * All that is shown is the id, the event it belongs to (an id) and whether it is down: **never the
 * text**, because the server sends none and this card has nowhere to put one.
 */
export function GuestbookTakedownCard() {
  const t = useTranslations()
  const api = useApi()
  const latest = useRef(0)
  const [text, setText] = useState('')
  const [found, setFound] = useState<SiteGuestbookStateDto | null>(null)
  const [missing, setMissing] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  const read = useCallback(
    (id: string) => {
      setFailure(null)
      setMissing(false)
      setSearching(true)
      const mine = ++latest.current
      return api.siteGuestbookState(id).then(
        (state) => {
          if (mine !== latest.current) return
          setFound(state)
          setSearching(false)
        },
        (cause: unknown) => {
          if (mine !== latest.current) return
          setFound(null)
          if (cause instanceof ApiError && cause.code === 'guestbook.notFound') setMissing(true)
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
    <Card as="h2" title={t.site.takedownGuestbookTitle} subtitle={t.site.takedownGuestbookIntro}>
      <form className={styles['form']} onSubmit={search}>
        <Field label={t.site.takedownGuestbookLabel}>
          {(control) => (
            <TextInput
              {...control}
              name="entryId"
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
            {t.site.takedownGuestbookAction}
          </Button>
        </div>
      </form>
      {failure === null ? null : <p role="alert">{failure}</p>}
      {missing ? <p role="status">{t.site.takedownGuestbookNone}</p> : null}
      {found === null ? null : (
        <ul className={styles['list']}>
          <TakedownRow
            heading={t.site.takedownGuestbookHeading(found.id)}
            id={found.id}
            states={[
              found.takenDownAt === null
                ? { label: t.site.takedownStateUp, tone: 'success' }
                : { label: t.site.takedownStateDown, tone: 'danger' },
            ]}
            details={t.site.takedownGuestbookOf(found.eventId)}
            buttons={[
              found.takenDownAt === null
                ? { op: 'guestbookDown', label: t.site.takedownGuestbookDown }
                : { op: 'guestbookUp', label: t.site.takedownGuestbookUp },
            ]}
            onDone={() => void read(found.id)}
          />
        </ul>
      )}
    </Card>
  )
}
