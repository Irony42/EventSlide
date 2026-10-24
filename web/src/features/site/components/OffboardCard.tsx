import { useCallback, useState, type FormEvent } from 'react'
import { useApi } from '../../../app/useApi'
import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { ConfirmDialog } from '../../../design-system/components/ConfirmDialog'
import { Field } from '../../../design-system/components/Field'
import { TextInput } from '../../../design-system/components/TextInput'
import { useToast } from '../../../design-system/components/useToast'
import type { SiteClientDto } from '../../../lib/api/dto'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { useOperatorAction } from '../hooks/useOperatorAction'
import { standingOf } from '../siteLabels'
import styles from './OffboardCard.module.css'

export interface OffboardCardProps {
  readonly client: SiteClientDto
  readonly onChanged: () => void
}

/** Whole days, as text: the one judgement made here. Whether the window is in range is the server's. */
const wholeDays = (text: string): number | null => {
  const trimmed = text.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const days = Number(trimmed)
  return Number.isSafeInteger(days) ? days : null
}

/**
 * Ends an engagement (`POST /api/site/clients/:clientId/offboard`): the client's live events are
 * closed and its drafts archived, the client is suspended, and its albums are purged when the window
 * the operator gives runs out, which is the time the client has to export what it wants to keep.
 *
 * Surface: the operator's laptop. **It is one of the two acts of the console that cannot be taken
 * back** (deleting an account is the other), so it is asked twice: the number of days, then a confirmation that says
 * how many and what happens, and then the confirmation of the person (the step-up) if the server
 * asks for it. The console checks no range for the window and sends whatever whole number was typed: a
 * window out of range is refused by the server (`client.graceInvalid`), and the sentence for that
 * says no number, so a bound changed there is not a bound left stale here. (The sentence for the
 * ceilings' own refusals does print theirs, as the host's console does for its own: those are copy,
 * not checks.)
 *
 * A client already being wound down shows that and offers nothing more: the server keeps the first
 * date whatever a second request asks for, and a form that cannot change anything is not offered.
 */
export function OffboardCard({ client, onChanged }: OffboardCardProps) {
  const t = useTranslations()
  const api = useApi()
  const toast = useToast()
  const [text, setText] = useState('30')
  const [invalid, setInvalid] = useState(false)
  const [days, setDays] = useState<number | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const offboard = useOperatorAction(
    useCallback((id: string, window: number) => api.siteOffboardClient(id, window), [api]),
  )

  if (standingOf(client) === 'offboarding') {
    return (
      <Card as="h2" title={t.site.offboardTitle}>
        <p>{t.site.offboardingRunning}</p>
      </Card>
    )
  }

  const ask = (event: FormEvent) => {
    event.preventDefault()
    setFailure(null)
    const window = wholeDays(text)
    setInvalid(window === null)
    setDays(window)
  }

  const confirm = () => {
    if (days === null) return
    void offboard.run('offboard', client.id, days).then((result) => {
      setDays(null)
      if (!result.ok) {
        setFailure(result.message)
        return
      }
      toast.show(t.site.offboardedDone, { tone: 'success' })
      onChanged()
    })
  }

  return (
    <Card as="h2" title={t.site.offboardTitle} subtitle={t.site.offboardIntro}>
      <form className={styles['form']} onSubmit={ask}>
        <Field
          label={t.site.graceDays}
          hint={t.site.graceDaysHint}
          {...(invalid ? { error: t.site.daysNotWhole } : {})}
        >
          {(control) => (
            <TextInput
              {...control}
              name="graceDays"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              required
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          )}
        </Field>
        {failure === null ? null : <p role="alert">{failure}</p>}
        <div>
          <Button type="submit" variant="danger" disabled={offboard.busy}>
            {t.site.offboardAction}
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={days !== null}
        title={t.site.offboardConfirmTitle}
        description={t.site.offboardConfirmBody(days ?? 0)}
        confirmLabel={t.site.offboardAction}
        busy={offboard.busy}
        onConfirm={confirm}
        onCancel={() => setDays(null)}
      />
    </Card>
  )
}
