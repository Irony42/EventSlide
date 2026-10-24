import { useId, useRef, useState, type FormEvent, type RefObject } from 'react'
import { useApi } from '../../../app/useApi'
import { useSession } from '../../../app/useSession'
import { Button } from '../../../design-system/components/Button'
import { Dialog } from '../../../design-system/components/Dialog'
import { Field } from '../../../design-system/components/Field'
import { TextInput } from '../../../design-system/components/TextInput'
import { useToast } from '../../../design-system/components/useToast'
import type { SecondFactorProof } from '../../../lib/api/dto'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { errorMessage } from '../../admin/errorMessage'
import styles from './StepUpDialog.module.css'

export interface StepUpDialogProps {
  readonly open: boolean
  /** The server took the confirmation. */
  readonly onConfirmed: () => void
  /** The person gave up. Nothing was confirmed and the write that asked is not sent. */
  readonly onCancel: () => void
}

/**
 * The confirmation the operator's writes ask for (`POST /api/auth/step-up`): the password again
 * and, for an account that has an authenticator, a fresh code (or one recovery code, behind a
 * toggle because it is the exception).
 *
 * Surface: the operator's laptop. It is the second half of what `SecurityPage` already does for
 * the factor's own actions, in a dialog, because the person is in the middle of something.
 *
 * Nothing here decides whether a code is right: the server's code picks the sentence, a wrong one
 * keeps what was typed, and the answer for a code that already signed in ("wait for the app's next
 * one") is the server's `auth.invalidSecondFactor`.
 */
export function StepUpDialog({ open, onConfirmed, onCancel }: StepUpDialogProps) {
  const t = useTranslations()
  const formId = useId()
  const passwordRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  return (
    <Dialog
      open={open}
      title={t.site.stepUpTitle}
      description={t.site.stepUpIntro}
      onClose={onCancel}
      initialFocusRef={passwordRef}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t.app.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={busy}>
            {t.auth.stepUpSubmit}
          </Button>
        </>
      }
    >
      <StepUpForm
        id={formId}
        passwordRef={passwordRef}
        onBusy={setBusy}
        onConfirmed={onConfirmed}
      />
    </Dialog>
  )
}

interface StepUpFormProps {
  readonly id: string
  readonly passwordRef: RefObject<HTMLInputElement | null>
  readonly onBusy: (busy: boolean) => void
  readonly onConfirmed: () => void
}

/** Mounted only while the dialog is open, so every opening starts with an empty form. */
function StepUpForm({ id, passwordRef, onBusy, onConfirmed }: StepUpFormProps) {
  const t = useTranslations()
  const api = useApi()
  const toast = useToast()
  const { session } = useSession()
  const enrolled = session?.authenticated === true && session.user.secondFactor.enrolled
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'code' | 'recovery'>('code')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const proof = (): SecondFactorProof | undefined => {
    if (!enrolled) return undefined
    return mode === 'code' ? { code: value.trim() } : { recoveryCode: value.trim() }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onBusy(true)
    setError(null)
    api.stepUp(password, proof()).then(
      () => {
        onBusy(false)
        toast.show(t.auth.stepUpDone, { tone: 'success' })
        onConfirmed()
      },
      (cause: unknown) => {
        onBusy(false)
        setError(errorMessage(cause, t))
      },
    )
  }

  return (
    <form id={id} className={styles['form']} onSubmit={submit}>
      <Field label={t.auth.password}>
        {(control) => (
          <TextInput
            {...control}
            ref={passwordRef}
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </Field>
      {enrolled ? (
        <>
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMode((current) => (current === 'code' ? 'recovery' : 'code'))
              setValue('')
            }}
          >
            {mode === 'code' ? t.auth.secondFactorRecoveryToggle : t.auth.secondFactorAppToggle}
          </Button>
        </>
      ) : null}
      {error === null ? null : <p role="alert">{error}</p>}
    </form>
  )
}
