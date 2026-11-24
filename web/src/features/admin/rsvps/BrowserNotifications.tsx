import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckboxField } from '../../../design-system/components/CheckboxField'
import { Notice } from '../../../design-system/components/Notice'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import {
  browserEnv,
  disablePush,
  enablePush,
  readPushState,
  type PushEnv,
  type PushState,
} from '../../../lib/push/browserPush'
import { useApi } from '../../../lib/useApi'
import { useLoader } from '../../../lib/useLoader'
import styles from './RsvpsPage.module.css'

/**
 * "Notification du navigateur" (spec 30, lot 4): the host's checkbox on the Réponses page.
 *
 * - **Not there at all** while the box has no push key (`404 push.disabled`) or cannot be asked.
 * - The permission is asked **only when the box is ticked**, never on load; a denial is said, with
 *   where to change it, and the box stays off.
 * - On an iPhone the notification exists only for an app added to the home screen: the page says so
 *   instead of offering a box that cannot work.
 * - Unticking tells the server to forget this browser for this event.
 */
export function BrowserNotifications({
  slug,
  env: given,
}: {
  readonly slug: string
  /** The browser, replaced by a test. */
  readonly env?: PushEnv
}) {
  const t = useTranslations().rsvp.push
  const api = useApi()
  const env = useMemo(() => given ?? browserEnv(), [given])
  const [state, setState] = useState<PushState | null>(null)
  const [working, setWorking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const read = useCallback(() => readPushState(slug, env).then(setState), [slug, env])
  // The box's key, read once: an answer (not `push.disabled`, not a failure) is what offers the checkbox.
  const loadKey = useCallback((signal: AbortSignal) => api.pushKey(signal), [api])
  const offered = useLoader(loadKey).data !== null
  useEffect(() => {
    if (offered) void read()
  }, [offered, read])

  if (!offered || state === null) return null

  const change = async (on: boolean) => {
    setWorking(true)
    setProblem(null)
    try {
      if (on) {
        const outcome = await enablePush(api, slug, env)
        if (outcome === 'failed') setProblem(t.failed)
      } else if (!(await disablePush(api, slug, env))) {
        setProblem(t.offFailed)
      }
    } finally {
      await read()
      setWorking(false)
    }
  }

  const denied = state.permission === 'denied'
  const blocked = state.support !== 'supported' || denied
  const hint =
    state.support === 'addToHomeScreen'
      ? t.addToHomeScreen
      : state.support === 'unsupported'
        ? t.unsupported
        : denied
          ? t.denied
          : t.hint
  return (
    <div className={styles['push']}>
      <CheckboxField
        label={t.label}
        hint={hint}
        checked={state.subscribed}
        disabled={blocked || working}
        onChange={(on) => void change(on)}
      />
      {problem === null ? null : (
        <Notice tone="danger" variant="inline" role="alert">
          {problem}
        </Notice>
      )}
    </div>
  )
}
