import { useCallback, useId, useState } from 'react'
import { Button } from '../../design-system/components/Button'
import { CheckboxField } from '../../design-system/components/CheckboxField'
import { Notice } from '../../design-system/components/Notice'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { useApi } from '../../lib/useApi'
import { useLoader } from '../../lib/useLoader'
import styles from './SecurityPage.module.css'

type Family = 'rsvp' | 'event'
const FAMILIES: readonly Family[] = ['rsvp', 'event']

/**
 * "E-mails" (spec 32): the two switches of the account, on the security page.
 *
 * - **Hidden on a box that writes to nobody** (`available` false: no relay, or `HOST_MAIL_NOTICES=off`), and until the answer is
 *   known. A **failed read is not "nobody"**: it says so, with a button to try again.
 * - **Saves at once and shows the choice at once** (optimistic), **one write in flight per family**: pressing the other switch
 *   meanwhile is never blocked or lost, pressing the same one again waits for its write. A failed write puts the box back and
 *   says so next to that switch (`aria-describedby`); the notice stays until that switch is tried again.
 * - A polite `role="status"` says "Saving…" while any write is in flight. The boxes stay enabled (a disabled box would drop the
 *   keyboard focus).
 * - **Says what is always sent** (the security mails of the account, the warning before the replies are erased): they have no
 *   switch, and a host who ticked everything off should not believe they will hear nothing.
 * - What the page read is not re-read while it is open: a second tab that changes a switch is not followed (accepted, the next
 *   visit reads the truth).
 */
export function MailPreferencesSection() {
  const t = useTranslations().auth.mailPreferences
  const api = useApi()
  const headingId = useId()
  const alertId = useId()
  const load = useCallback((signal: AbortSignal) => api.mailPreferences(signal), [api])
  const loader = useLoader(load)
  const loaded = loader.data
  const [shown, setShown] = useState<Partial<Record<Family, boolean>>>({})
  const [saving, setSaving] = useState<Partial<Record<Family, boolean>>>({})
  const [failed, setFailed] = useState<Partial<Record<Family, boolean>>>({})

  if (loaded === null) {
    return loader.error === null ? null : (
      <section className={styles['section']} aria-labelledby={headingId}>
        <h2 id={headingId} className={styles['heading']}>
          {t.title}
        </h2>
        <Notice tone="danger" variant="inline" role="alert">
          {t.loadFailed}
        </Notice>
        <div className={styles['actions']}>
          <Button onClick={loader.reload}>{t.retry}</Button>
        </div>
      </section>
    )
  }
  if (!loaded.available) return null

  const value = (family: Family): boolean => shown[family] ?? loaded[family]
  const anySaving = FAMILIES.some((family) => saving[family] === true)
  const failedFamily = FAMILIES.find((family) => failed[family] === true)

  const change = async (family: Family, next: boolean) => {
    if (saving[family] === true) return
    const before = value(family)
    setShown((held) => ({ ...held, [family]: next }))
    setSaving((held) => ({ ...held, [family]: true }))
    setFailed((held) => ({ ...held, [family]: false }))
    try {
      await api.setMailPreferences({ [family]: next })
    } catch {
      setShown((held) => ({ ...held, [family]: before }))
      setFailed((held) => ({ ...held, [family]: true }))
    } finally {
      setSaving((held) => ({ ...held, [family]: false }))
    }
  }

  const describedBy = (family: Family): string | undefined =>
    failed[family] === true ? alertId : undefined

  return (
    <section className={styles['section']} aria-labelledby={headingId} aria-busy={anySaving}>
      <h2 id={headingId} className={styles['heading']}>
        {t.title}
      </h2>
      <p>{t.intro}</p>
      <fieldset className={styles['fieldset']}>
        <legend className={styles['legend']}>{t.legend}</legend>
        <CheckboxField
          label={t.rsvpLabel}
          hint={t.rsvpHint}
          checked={value('rsvp')}
          onChange={(next) => void change('rsvp', next)}
          {...(describedBy('rsvp') === undefined ? {} : { describedBy: alertId })}
        />
        <CheckboxField
          label={t.eventLabel}
          hint={t.eventHint}
          checked={value('event')}
          onChange={(next) => void change('event', next)}
          {...(describedBy('event') === undefined ? {} : { describedBy: alertId })}
        />
      </fieldset>
      <p role="status" className={styles['status']}>
        {anySaving ? t.saving : ''}
      </p>
      {failedFamily === undefined ? null : (
        <Notice tone="danger" variant="inline" role="alert" id={alertId}>
          {t.failed}
        </Notice>
      )}
      <p>{t.always}</p>
    </section>
  )
}
