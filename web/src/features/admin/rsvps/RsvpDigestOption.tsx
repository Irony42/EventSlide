import { useCallback, useState } from 'react'
import { CheckboxField } from '../../../design-system/components/CheckboxField'
import { Notice } from '../../../design-system/components/Notice'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { useApi } from '../../../lib/useApi'
import { useLoader } from '../../../lib/useLoader'
import styles from './RsvpsPage.module.css'

/**
 * "Recevoir un résumé par e-mail (au plus un par jour)" (spec 32, R2): the owner's checkbox of the replies page, on the
 * panel that says how to be told.
 *
 * - **Only on a box that writes to its hosts** (`features.hostMail`, which the page reads before it renders this): a box with no
 *   relay, or with `HOST_MAIL_NOTICES=off`, shows nothing.
 * - **The account's own switch beats the box**: with the replies e-mails turned off in "Sécurité et e-mails" the checkbox is
 *   greyed and says so, because the summary would not leave whatever is ticked here. **Until the account's answer is known the
 *   box is not switchable**: a box that turns live is better than one that turns grey under the finger.
 * - It saves at once, for this event and this account only, and tells when it could not. While it saves the box stays enabled (a
 *   disabled box would drop the keyboard focus) and says it is busy; a second press meanwhile is ignored.
 * - It follows the page: what the page reads again (another tab, the same owner elsewhere) replaces what is shown.
 */
export function RsvpDigestOption({
  slug,
  initial,
}: {
  readonly slug: string
  /** What the replies page read (`rsvpDigest`). */
  readonly initial: boolean
}) {
  const t = useTranslations().rsvp.digest
  const api = useApi()
  const [on, setOn] = useState(initial)
  const [working, setWorking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // What the page reads again replaces what is shown (set during render, which is how a prop is followed without an effect).
  const [seen, setSeen] = useState(initial)
  if (seen !== initial) {
    setSeen(initial)
    setOn(initial)
  }

  const loadPreferences = useCallback((signal: AbortSignal) => api.mailPreferences(signal), [api])
  const preferences = useLoader(loadPreferences).data
  const known = preferences !== null
  const accountOff = preferences?.rsvp === false

  const change = async (next: boolean) => {
    if (working) return
    setWorking(true)
    setProblem(null)
    try {
      await api.setRsvpDigest(slug, next)
      setOn(next)
    } catch {
      setProblem(t.failed)
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className={styles['push']} aria-busy={working}>
      <CheckboxField
        label={t.label}
        hint={accountOff ? t.offByAccount : t.hint}
        checked={on}
        disabled={!known || accountOff}
        onChange={(next) => void change(next)}
      />
      {problem === null ? null : (
        <Notice tone="danger" variant="inline" role="alert">
          {problem}
        </Notice>
      )}
    </div>
  )
}
