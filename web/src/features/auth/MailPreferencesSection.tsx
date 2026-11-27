import { useCallback, useId, useState } from 'react'
import { CheckboxField } from '../../design-system/components/CheckboxField'
import { Notice } from '../../design-system/components/Notice'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { useApi } from '../../lib/useApi'
import { useLoader } from '../../lib/useLoader'
import styles from './SecurityPage.module.css'

type Family = 'rsvp' | 'event'

/**
 * "E-mails" (spec 32): the two switches of the account, on the security page.
 *
 * - **Hidden on a box that writes to nobody** (`available` false: no relay, or `HOST_MAIL_NOTICES=off`), and until the answer is
 *   known: a switch that turns up late is better than one that turns away.
 * - **Saves at once**, one family at a time, and says when it could not. While one saves its box stays enabled (a disabled box
 *   would drop the keyboard focus) and the section says it is busy; a second press meanwhile is ignored.
 * - **Says what is always sent** (the security mails of the account, the warning before the replies are erased): they have no
 *   switch, and a host who ticked everything off should not believe they will hear nothing.
 */
export function MailPreferencesSection() {
  const t = useTranslations().auth.mailPreferences
  const api = useApi()
  const headingId = useId()
  const load = useCallback((signal: AbortSignal) => api.mailPreferences(signal), [api])
  const loaded = useLoader(load).data
  const [changed, setChanged] = useState<Partial<Record<Family, boolean>>>({})
  const [working, setWorking] = useState(false)
  const [problem, setProblem] = useState(false)

  if (loaded === null || !loaded.available) return null

  const value = (family: Family): boolean => changed[family] ?? loaded[family]

  const change = async (family: Family, next: boolean) => {
    if (working) return
    setWorking(true)
    setProblem(false)
    try {
      await api.setMailPreferences({ [family]: next })
      setChanged((held) => ({ ...held, [family]: next }))
    } catch {
      setProblem(true)
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className={styles['section']} aria-labelledby={headingId} aria-busy={working}>
      <h2 id={headingId} className={styles['heading']}>
        {t.title}
      </h2>
      <p>{t.intro}</p>
      <CheckboxField
        label={t.rsvpLabel}
        hint={t.rsvpHint}
        checked={value('rsvp')}
        onChange={(next) => void change('rsvp', next)}
      />
      <CheckboxField
        label={t.eventLabel}
        hint={t.eventHint}
        checked={value('event')}
        onChange={(next) => void change('event', next)}
      />
      {problem ? (
        <Notice tone="danger" variant="inline" role="alert">
          {t.failed}
        </Notice>
      ) : null}
      <p>{t.always}</p>
    </section>
  )
}
