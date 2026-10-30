import { useCallback, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../../../app/useApi'
import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { Field } from '../../../design-system/components/Field'
import { TextInput } from '../../../design-system/components/TextInput'
import type { SiteEventStateDto } from '../../../lib/api/dto'
import { messageForError } from '../../../lib/i18n/translations'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { eventStatusLabel } from '../siteLabels'
import type { TakedownOp } from '../takedownOps'
import { TakedownRow, type TakedownButton } from './TakedownRow'
import styles from './TakedownCard.module.css'

/**
 * Finds an event from what a report gave the operator, and acts on it by id
 * (`GET /api/site/events/lookup`, then the take-down and purge-hold routes).
 *
 * Surface: the operator's laptop. What comes back is an id, a status, a client and two instants:
 * **no name, no slug, no join code**, so the operator learns which event a report names and never
 * what it is called. The acts that apply follow the state (an event that is down offers to be put
 * back, one that is up offers to be taken down, and the same for the purge hold).
 */
export function EventTakedownCard() {
  const t = useTranslations()
  const api = useApi()
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<readonly SiteEventStateDto[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  const search = (event: FormEvent) => {
    event.preventDefault()
    const asked = query.trim()
    if (asked === '') return
    setFailure(null)
    setSearching(true)
    api.siteLookupEvents(asked).then(
      (found) => {
        setRows(found.items)
        setSearching(false)
      },
      (cause: unknown) => {
        setRows(null)
        setFailure(messageForError(cause, t))
        setSearching(false)
      },
    )
  }

  const refresh = useCallback(
    (id: string) => {
      api.siteEventState(id).then(
        (state) =>
          setRows((current) =>
            current === null ? current : current.map((row) => (row.id === id ? state : row)),
          ),
        (cause: unknown) => setFailure(messageForError(cause, t)),
      )
    },
    [api, t],
  )

  const buttonsFor = (state: SiteEventStateDto): readonly TakedownButton[] => {
    const down: TakedownOp = state.takenDownAt === null ? 'eventDown' : 'eventUp'
    const held: TakedownOp = state.purgeHeldAt === null ? 'purgeHold' : 'purgeRelease'
    return [
      {
        op: down,
        label: state.takenDownAt === null ? t.site.takedownEventDown : t.site.takedownEventUp,
      },
      {
        op: held,
        label: state.purgeHeldAt === null ? t.site.takedownHold : t.site.takedownRelease,
      },
    ]
  }

  return (
    <Card as="h2" title={t.site.takedownEventTitle} subtitle={t.site.takedownEventIntro}>
      <form className={styles['form']} onSubmit={search}>
        <Field label={t.site.takedownEventLabel}>
          {(control) => (
            <TextInput
              {...control}
              name="eventQuery"
              autoComplete="off"
              spellCheck={false}
              required
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
        </Field>
        <div>
          <Button type="submit" variant="primary" loading={searching}>
            {t.site.takedownEventAction}
          </Button>
        </div>
      </form>
      {failure === null ? null : <p role="alert">{failure}</p>}
      {rows !== null && rows.length === 0 ? <p role="status">{t.site.takedownEventNone}</p> : null}
      {rows !== null && rows.length > 0 ? (
        <ul className={styles['list']}>
          {rows.map((row) => (
            <TakedownRow
              key={row.id}
              heading={t.site.takedownEventHeading(row.id)}
              id={row.id}
              states={[
                row.takenDownAt === null
                  ? { label: t.site.takedownStateUp, tone: 'success' }
                  : { label: t.site.takedownStateDown, tone: 'danger' },
                row.purgeHeldAt === null
                  ? { label: t.site.takedownStateFree, tone: 'success' }
                  : { label: t.site.takedownStateHeld, tone: 'warning' },
              ]}
              details={
                <>
                  {eventStatusLabel(row.status, t)} ·{' '}
                  {row.clientId === null ? (
                    t.site.takedownNoClient
                  ) : (
                    <Link to={`/admin/site/clients/${row.clientId}`}>{t.site.takedownClient}</Link>
                  )}
                </>
              }
              buttons={buttonsFor(row)}
              onDone={() => refresh(row.id)}
            />
          ))}
        </ul>
      ) : null}
    </Card>
  )
}
