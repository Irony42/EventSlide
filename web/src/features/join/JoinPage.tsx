import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useParams } from 'react-router-dom'
import { Button } from '../../design-system/components/Button'
import { Card } from '../../design-system/components/Card'
import { Field } from '../../design-system/components/Field'
import { Notice } from '../../design-system/components/Notice'
import { Spinner } from '../../design-system/components/Spinner'
import { Stack } from '../../design-system/components/Stack'
import { TextInput } from '../../design-system/components/TextInput'
import { readRememberedGuestSession } from '../../lib/guestSession'
import { isInstalled } from '../../lib/pwa/install'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { fromOf, useJoin } from './hooks/useJoin'
import styles from './JoinPage.module.css'
import { AmbianceMarker } from '../../design-system/components/AmbianceMarker'

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
 * **The installed app's icon opens `/join` with no code** (navigation pass, A1). A phone that
 * has joined an event before sends the guest straight back to it, from what the device
 * remembers (`lib/guestSession.ts`): no request, and the card with the code is not needed.
 * Only the installed app does this. In a browser tab `/join` is the code entry it has always
 * been, so a guest who types the next evening's code is not carried to last night's event.
 * "Ce n'est pas votre soirée ?" is the way out of both.
 *
 * The path is a path and not `?code=`, which is the 1.0 defect this whole route exists
 * to prevent: the QR page emitted `?partyname=` and the upload page read `?party`, so
 * every guest silently uploaded to the default event.
 */
export function JoinPage() {
  const t = useTranslations()
  const { code: codeFromPath } = useParams()
  const { phase, event, error, errorCode, join, continueToUpload, leave } = useJoin()

  const [code, setCode] = useState(codeFromPath ?? '')
  /** Read once, at mount: the memory is not something this screen re-reads as it renders. */
  const heading = fromOf(useLocation().state)
  const [resumable] = useState(() =>
    // Not when a guest screen sent them here to type a code (`from`): they asked for that
    // event's address, and carrying them to the remembered one would hide the code entry they
    // were sent to.
    codeFromPath === undefined && heading === undefined && isInstalled()
      ? readRememberedGuestSession()
      : null,
  )
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

  if (resumable !== null) {
    return <Navigate to={`/e/${encodeURIComponent(resumable.event.slug)}/upload`} replace />
  }

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
    <Field label={t.join.nameLabel} hint={t.join.nameHint} optional>
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
        {t.join.submit}
      </Button>
      {/* Anonymity is a supported choice, so it gets its own control rather than
          being something a guest has to infer from leaving a field empty. */}
      <Button variant="ghost" size="lg" block disabled={busy} onClick={() => submit(false)}>
        {t.join.anonymous}
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
            {t.join.submitting}
          </p>
        </Stack>
      </Card>
    )
  }

  if (event !== null) {
    return (
      <>
        {/* The welcome is the first screen of the event: it wears its ambiance (ADR 0010). */}
        <AmbianceMarker ambiance={event.theme.ambiance} groundUrl={event.theme.groundUrl} />
        <Card as="h1" title={t.join.welcome(event.name)} className={styles['card']}>
          <form className={styles['form']} onSubmit={handleSubmit} noValidate>
            {/*
            The failure that belongs to the whole step rather than to one field: a name
            could not be recorded, or the connection dropped after the code had already
            resolved. A code that was refused is reported on the code field instead,
            where the correction has to happen.
          */}
            {error === null ? null : (
              <Notice tone="danger" role="alert" variant="boxed">
                {error}
              </Notice>
            )}
            {nameField}
            {actions}
            {/* A scan of somebody else's card, or last night's: the guest has no other way
              back to a code entry, and the code in the address would resolve again. */}
            <Button
              variant="ghost"
              size="sm"
              block
              onClick={() => {
                // The typed code is the one that led here: left in the box it would be offered again.
                setCode('')
                setName('')
                setPressed(false)
                leave(event.slug)
              }}
            >
              {t.join.notYourEvening}
            </Button>
          </form>
        </Card>
      </>
    )
  }

  return (
    <Card as="h1" title={t.join.title} className={styles['card']}>
      <form className={styles['form']} onSubmit={handleSubmit} noValidate>
        <Field
          label={t.join.codeLabel}
          hint={t.join.codeHint}
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
        {/* The server answers one thing for a code it does not know, an evening that is
            over and one that has not opened (so that codes cannot be enumerated), and so does
            this line: it says what the guest can do, not which one it is. */}
        {errorCode === 'event.notFound' ? (
          <p className={styles['hint']} role="status">
            {t.join.notOpenHint}
          </p>
        ) : null}
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
            {t.join.submit}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            block
            disabled={busy || code.trim().length === 0}
            onClick={() => submit(false)}
          >
            {t.join.anonymous}
          </Button>
        </Stack>
      </form>
      {/* Discreet, and a plain link: no request is made for it. The front door stays the
          guest's, and a host who typed the bare domain still has a way in (decision 1). */}
      <Link className={styles['organiser']} to="/login">
        {t.join.organiserLink}
      </Link>
    </Card>
  )
}
