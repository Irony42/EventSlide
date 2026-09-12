import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { Field } from '../../design-system/components/Field'
import { Spinner } from '../../design-system/components/Spinner'
import { Stack } from '../../design-system/components/Stack'
import { StatusIcon } from '../../design-system/components/StatusIcon'
import { TextInput } from '../../design-system/components/TextInput'
import { fr } from '../../lib/i18n/fr'
import { useJoin } from './hooks/useJoin'
import styles from './JoinPage.module.css'

/**
 * The front door, on a phone. `/join/:code` and `/join`.
 *
 * Two ways in, one destination:
 *
 * - **Scanned a QR code.** The code is in the path, so it is submitted on mount. The
 *   guest pressed nothing to get here and must not have to press anything to have the
 *   code accepted. What is left is their first name, which is optional, so the screen
 *   they land on is a welcome and not a form.
 * - **Read a printed card.** They type the six characters themselves. Nothing is
 *   validated locally: the server normalises case, separators and confusable
 *   characters, and a client that rejected `h7k-2qm` would be wrong about a code the
 *   server accepts.
 *
 * The path is a path and not `?code=`, which is the 1.0 defect this whole route exists
 * to prevent: the QR page emitted `?partyname=` and the upload page read `?party`, so
 * every guest silently uploaded to the default event.
 */
export function JoinPage() {
  const { code: codeFromPath } = useParams()
  const { phase, event, error, join, continueToUpload } = useJoin()

  const [code, setCode] = useState(codeFromPath ?? '')
  const [name, setName] = useState('')

  const autoSubmitted = useRef(false)
  /**
   * Whether the guest has pressed anything yet.
   *
   * It decides between a full-screen wait — right for a scan the guest did not press
   * for — and a busy button, which keeps the form and the values they typed on screen.
   */
  const [pressed, setPressed] = useState(false)

  useEffect(() => {
    if (codeFromPath === undefined || autoSubmitted.current) return
    autoSubmitted.current = true
    join({ code: codeFromPath, displayName: null, advance: false })
  }, [codeFromPath, join])

  const trimmedName = name.trim()
  const displayName = trimmedName.length > 0 ? trimmedName : null
  const busy = phase === 'joining'

  const submit = (withName: boolean) => {
    setPressed(true)
    if (event !== null) {
      // The code already resolved on mount, so the name is the only thing left to
      // record and an empty one is nothing to ask the server about.
      if (!withName || displayName === null) {
        continueToUpload(event.slug)
        return
      }
      join({ code, displayName, advance: true })
      return
    }
    join({ code, displayName: withName ? displayName : null, advance: true })
  }

  const handleSubmit = (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault()
    submit(true)
  }

  const nameField = (
    <Field label={fr.join.nameLabel} hint={fr.join.nameHint} optional>
      {(control) => (
        <TextInput
          {...control}
          value={name}
          onChange={(changed) => setName(changed.target.value)}
          autoComplete="given-name"
          enterKeyHint="go"
        />
      )}
    </Field>
  )

  const actions = (
    <Stack gap="3">
      <Button type="submit" variant="primary" size="lg" block loading={busy}>
        {fr.join.submit}
      </Button>
      {/* Anonymity is a supported choice, so it gets its own control rather than
          being something a guest has to infer from leaving a field empty. */}
      <Button variant="ghost" size="lg" block disabled={busy} onClick={() => submit(false)}>
        {fr.join.anonymous}
      </Button>
    </Stack>
  )

  if (event === null && busy && !pressed) {
    return (
      <Card className={styles['card']}>
        <Stack align="center" gap="4">
          <Spinner size="lg" />
          {/* role="status" rather than a Spinner label: on a phone the wait needs to
              be readable, not only announced. */}
          <p className={styles['resolving']} role="status">
            {fr.join.submitting}
          </p>
        </Stack>
      </Card>
    )
  }

  if (event !== null) {
    return (
      <Card as="h1" title={fr.join.welcome(event.name)} className={styles['card']}>
        <form className={styles['form']} onSubmit={handleSubmit} noValidate>
          {error === null ? null : (
            <p className={styles['error']} role="alert">
              <StatusIcon tone="danger" />
              {error}
            </p>
          )}
          {nameField}
          {actions}
        </form>
      </Card>
    )
  }

  return (
    <Card as="h1" title={fr.join.title} className={styles['card']}>
      <form className={styles['form']} onSubmit={handleSubmit} noValidate>
        <Field
          label={fr.join.codeLabel}
          hint={fr.join.codeHint}
          {...(error === null ? {} : { error })}
        >
          {(control) => (
            <TextInput
              {...control}
              variant="code"
              value={code}
              onChange={(changed) => setCode(changed.target.value)}
              // `text`, not `numeric`: a join code mixes letters and digits, and a
              // number pad would leave a guest hunting for the letters.
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              required
            />
          )}
        </Field>
        {nameField}
        <Stack gap="3">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            loading={busy}
            disabled={code.trim().length === 0}
          >
            {fr.join.submit}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            block
            disabled={busy || code.trim().length === 0}
            onClick={() => submit(false)}
          >
            {fr.join.anonymous}
          </Button>
        </Stack>
      </form>
    </Card>
  )
}
