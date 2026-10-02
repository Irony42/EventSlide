import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useState } from 'react'
import { useApi } from '../../app/useApi'
import { useSession } from '../../app/useSession'
import { Button } from '../../design-system/components/Button'
import { Field } from '../../design-system/components/Field'
import { Spinner } from '../../design-system/components/Spinner'
import { TextInput } from '../../design-system/components/TextInput'
import { useToast } from '../../design-system/components/useToast'
import type { SecondFactorProof, TotpEnrolmentDto } from '../../lib/api/dto'
import { ApiError } from '../../lib/http'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { AuthForm } from './components/AuthForm'
import { errorMessage } from './errorMessage'
import styles from './SecurityPage.module.css'

/**
 * An action the page takes against the server, as view-state: the busy flag, the sentence
 * for a refusal, and a runner that resolves with the answer or `null` when it failed. A
 * caller that must react to *which* refusal it was passes `onRefused`, handed the server's code.
 */
const useAction = () => {
  const t = useTranslations()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async <T,>(
      action: () => Promise<T>,
      onRefused?: (code: string | undefined) => void,
    ): Promise<{ readonly value: T } | null> => {
      setBusy(true)
      setError(null)
      try {
        return { value: await action() }
      } catch (cause) {
        setError(errorMessage(cause, t))
        onRefused?.(cause instanceof ApiError ? cause.code : undefined)
        return null
      } finally {
        setBusy(false)
      }
    },
    [t],
  )

  /** Forgets a refusal that is no longer the page's news, such as one a new confirmation answered. */
  const reset = useCallback(() => setError(null), [])

  return { busy, error, run, reset }
}

/** The ten codes, once: copy them, write them down, and say so. */
function RecoveryCodes({
  codes,
  onSaved,
}: {
  readonly codes: readonly string[]
  readonly onSaved: () => void
}) {
  const t = useTranslations()
  const toast = useToast()

  const copy = () => {
    // Some browsers ship no clipboard in an insecure context; a guard is cheaper than a click
    // that throws, and the codes are on screen to be written down either way.
    if (typeof navigator.clipboard?.writeText !== 'function') return
    void navigator.clipboard
      .writeText(codes.join('\n'))
      .then(() => toast.show(t.auth.recoveryCodesCopied, { tone: 'success' }))
  }

  return (
    <section className={styles['section']} aria-labelledby="recovery-codes-title">
      <h2 id="recovery-codes-title" className={styles['heading']}>
        {t.auth.recoveryCodesTitle}
      </h2>
      <p>{t.auth.recoveryCodesIntro}</p>
      <ul className={styles['codes']}>
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <div className={styles['actions']}>
        <Button onClick={copy}>{t.auth.recoveryCodesCopy}</Button>
        <Button variant="primary" onClick={onSaved}>
          {t.auth.recoveryCodesSaved}
        </Button>
      </div>
    </section>
  )
}

/** The enrolment: the password, then the QR code and the proof. */
function Enrol({ onEnrolled }: { readonly onEnrolled: (codes: readonly string[]) => void }) {
  const t = useTranslations()
  const api = useApi()
  const start = useAction()
  const confirm = useAction()
  const [password, setPassword] = useState('')
  const [enrolment, setEnrolment] = useState<TotpEnrolmentDto | null>(null)
  const [code, setCode] = useState('')

  if (enrolment === null) {
    return (
      <AuthForm
        title={t.auth.securityTitle}
        intro={t.auth.setupIntro}
        error={start.error}
        submitting={start.busy}
        submitLabel={t.auth.setupStart}
        onSubmit={() => {
          void start
            .run(() => api.enrollSecondFactor(password))
            .then((answer) => {
              if (answer !== null) setEnrolment(answer.value)
            })
        }}
      >
        <Field label={t.auth.password}>
          {(control) => (
            <TextInput
              {...control}
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
      </AuthForm>
    )
  }

  return (
    <AuthForm
      title={t.auth.securityTitle}
      intro={t.auth.setupScan}
      error={confirm.error}
      submitting={confirm.busy}
      submitLabel={t.auth.setupConfirm}
      onSubmit={() => {
        void confirm
          .run(() => api.confirmSecondFactor(code.trim()))
          .then((answer) => {
            if (answer !== null) onEnrolled(answer.value.recoveryCodes)
          })
      }}
    >
      {/* The accessible name is on the wrapper: a QR code is a picture of a URI, and role="img"
          stops a screen reader walking a thousand paths. Drawn here, never as text, and never
          sent anywhere: the secret in it is the account's. */}
      <div className={styles['qr']} role="img" aria-label={t.auth.setupQrLabel}>
        <QRCodeSVG value={enrolment.otpauthUri} size={192} level="M" />
      </div>
      <p>
        {t.auth.setupKeyLabel} <code className={styles['key']}>{enrolment.secret}</code>
      </p>
      <Field label={t.auth.secondFactorCode}>
        {(control) => (
          <TextInput
            {...control}
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            spellCheck={false}
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        )}
      </Field>
    </AuthForm>
  )
}

/** An account that has an authenticator: confirm who you are, then renew the codes or switch it off. */
function Manage({
  onCodes,
  onDisabled,
}: {
  readonly onCodes: (codes: readonly string[]) => void
  readonly onDisabled: () => void
}) {
  const t = useTranslations()
  const api = useApi()
  const toast = useToast()
  const stepUp = useAction()
  const act = useAction()
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'code' | 'recovery'>('code')
  const [value, setValue] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  // The server said the confirmation ran out (five minutes) when an action was asked for. The
  // form comes back with that sentence, instead of leaving the person on a page that refuses
  // everything and offers no way to confirm again.
  const [lapsed, setLapsed] = useState(false)

  const whenRefused = (code: string | undefined): void => {
    if (code !== 'auth.stepUpRequired') return
    setLapsed(true)
    setConfirmed(false)
  }

  const proof = (): SecondFactorProof =>
    mode === 'code' ? { code: value.trim() } : { recoveryCode: value.trim() }

  if (!confirmed) {
    return (
      <AuthForm
        title={t.auth.securityTitle}
        intro={`${t.auth.securityEnabled} ${t.auth.securityManageIntro}`}
        error={stepUp.error ?? (lapsed ? t.errors['auth.stepUpRequired'] : null)}
        submitting={stepUp.busy}
        submitLabel={t.auth.stepUpSubmit}
        onSubmit={() => {
          void stepUp
            .run(() => api.stepUp(password, proof()))
            .then((answer) => {
              if (answer === null) return
              setLapsed(false)
              act.reset()
              setConfirmed(true)
              toast.show(t.auth.stepUpDone, { tone: 'success' })
            })
        }}
        footer={
          <Button
            variant="ghost"
            onClick={() => {
              setMode((current) => (current === 'code' ? 'recovery' : 'code'))
              setValue('')
            }}
          >
            {mode === 'code' ? t.auth.secondFactorRecoveryToggle : t.auth.secondFactorAppToggle}
          </Button>
        }
      >
        <Field label={t.auth.password}>
          {(control) => (
            <TextInput
              {...control}
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          )}
        </Field>
        <Field label={mode === 'code' ? t.auth.secondFactorCode : t.auth.recoveryCode}>
          {(control) => (
            <TextInput
              {...control}
              name={mode === 'code' ? 'code' : 'recoveryCode'}
              autoComplete={mode === 'code' ? 'one-time-code' : 'off'}
              inputMode={mode === 'code' ? 'numeric' : 'text'}
              spellCheck={false}
              required
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
        </Field>
      </AuthForm>
    )
  }

  return (
    <section className={styles['section']} aria-labelledby="manage-title">
      <h1 id="manage-title" className={styles['heading']}>
        {t.auth.securityTitle}
      </h1>
      {act.error === null ? null : <p role="alert">{act.error}</p>}
      <div className={styles['actions']}>
        <Button
          loading={act.busy}
          onClick={() => {
            void act
              .run(() => api.regenerateRecoveryCodes(), whenRefused)
              .then((answer) => {
                if (answer !== null) onCodes(answer.value.recoveryCodes)
              })
          }}
        >
          {t.auth.recoveryCodesRegenerate}
        </Button>
        <Button
          variant="danger"
          loading={act.busy}
          onClick={() => {
            void act
              .run(() => api.disableSecondFactor(), whenRefused)
              .then((answer) => {
                if (answer === null) return
                toast.show(t.auth.secondFactorDisabled, { tone: 'success' })
                onDisabled()
              })
          }}
        >
          {t.auth.secondFactorDisable}
        </Button>
      </div>
    </section>
  )
}

/**
 * Surface: the operator's laptop, reached on purpose (the console links here once it
 * exists; until then the address is the entry).
 *
 * Three states, decided by what `GET /api/auth/me` says about this account and this box: no
 * key (nothing can be offered, and the page says so), no authenticator (the enrolment), an
 * authenticator (confirm who you are, then renew the codes or switch it off).
 *
 * The recovery codes are shown from the moment they are minted until the person says they
 * have written them down, and **only held here**: they are not stored client-side and the
 * server cannot show them again, so a page that lost them on a re-render would have cost the
 * person their way back in.
 */
export function SecurityPage() {
  const t = useTranslations()
  const { session, loading, refresh } = useSession()
  const [codes, setCodes] = useState<readonly string[] | null>(null)

  if (codes !== null) {
    return (
      <RecoveryCodes
        codes={codes}
        onSaved={() => {
          setCodes(null)
          refresh()
        }}
      />
    )
  }

  if (loading || session === null || !session.authenticated) {
    return (
      <div className={styles['pending']}>
        <Spinner size="lg" label={t.shell.sessionChecking} />
      </div>
    )
  }

  const { available, enrolled } = session.user.secondFactor

  if (!enrolled && !available) {
    return (
      <section className={styles['section']}>
        <h1 className={styles['heading']}>{t.auth.securityTitle}</h1>
        <p>{t.auth.securityUnavailable}</p>
      </section>
    )
  }

  return enrolled ? (
    <Manage onCodes={setCodes} onDisabled={refresh} />
  ) : (
    <Enrol onEnrolled={setCodes} />
  )
}
