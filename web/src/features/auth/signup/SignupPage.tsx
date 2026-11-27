import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Field } from '../../../design-system/components/Field'
import { NewTabLink } from '../../../design-system/components/NewTabLink'
import { Textarea } from '../../../design-system/components/Textarea'
import { TextInput } from '../../../design-system/components/TextInput'
import { useLocale } from '../../../lib/i18n/useTranslations'
import { useAbout, useAboutHeard } from '../../../lib/useAbout'
import { AuthForm } from '../components/AuthForm'
import { AuthActions, AuthPage } from '../components/AuthPage'
import { useLangParam } from './hooks/useLangParam'
import { useRequestSignup } from './hooks/useSignup'
import styles from './SignupPage.module.css'

/** The limits the server enforces (spec 31 §3), applied here so the box says so before it is sent. */
const CLIENT_NAME_MAX = 80
const NOTE_MAX = 300

/** `YYYY-MM-DD` of a local date, which is what a date box holds. */
const isoDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/**
 * The dates the form accepts for the event, in the visitor's own calendar: from yesterday (a
 * party that is tonight, entered after midnight) to two years ahead. Nothing here is a rule of
 * the server; it stops a typo (`2206` for `2026`) before it is sent.
 */
const eventDateBounds = (now: Date): { readonly min: string; readonly max: string } => {
  const min = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const max = new Date(now.getFullYear() + 2, now.getMonth(), now.getDate())
  return { min: isoDay(min), max: isoDay(max) }
}

/** Something that could be an address: the shape the server asks of one and no more. */
const LOOKS_LIKE_AN_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * `/signup` (spec 31): ask for an account.
 *
 * Surface: **somebody who has no account yet**, reached from the sign-in page or from the
 * marketing site, which may add `?lang=de` so the form opens in the language of the page the
 * visitor came from (the language is then the one the mails are written in).
 *
 * The request is not an account: the server writes nothing but a request and mails a link, the
 * same answer for **every** address, so this page shows the same "check your inbox" for all of
 * them and learns nothing about who is registered. The one exception is the box's own daily cap,
 * which says nothing about an address (`busy`).
 *
 * The `website` box is a trap for bots: invisible and unreachable for people, sent empty by
 * them, and a filled one makes the server answer as usual and do nothing.
 *
 * Gated on `features.signup` only once the box has really said it is `off`: until it has, and
 * when its answer never comes, the form stays and the server remains the judge (a `404
 * feature.unavailable` gets a sentence of its own).
 */
export function SignupPage() {
  const { locale, text: t } = useLocale()
  useLangParam()
  const { submit, submitting, error } = useRequestSignup()
  const navigate = useNavigate()
  const { features, links } = useAbout()
  const heard = useAboutHeard()

  const [email, setEmail] = useState('')
  const [clientName, setClientName] = useState('')
  const [note, setNote] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [website, setWebsite] = useState('')
  const [malformed, setMalformed] = useState(false)
  const [nameMissing, setNameMissing] = useState(false)
  const [dateOutOfRange, setDateOutOfRange] = useState(false)
  const emailBox = useRef<HTMLInputElement>(null)
  const nameBox = useRef<HTMLInputElement>(null)
  const dateBox = useRef<HTMLInputElement>(null)
  // Recomputed with the page: a tab left open overnight must not offer yesterday's yesterday.
  const dateBounds = eventDateBounds(new Date())

  if (heard && features.signup === 'off') {
    return (
      <AuthPage title={t.signup.title} intro={t.signup.unavailable} focusTitle>
        <AuthActions>
          <Link to="/login">{t.auth.backToLogin}</Link>
        </AuthActions>
      </AuthPage>
    )
  }

  const handleSubmit = () => {
    const address = email.trim()
    const name = clientName.trim()
    const badAddress = !LOOKS_LIKE_AN_ADDRESS.test(address)
    const badDate = eventDate !== '' && (eventDate < dateBounds.min || eventDate > dateBounds.max)
    setMalformed(badAddress)
    setNameMissing(name === '')
    setDateOutOfRange(badDate)
    // The keyboard goes to the first box that needs fixing, in reading order.
    const firstInvalid = badAddress ? emailBox : name === '' ? nameBox : badDate ? dateBox : null
    if (firstInvalid !== null) {
      firstInvalid.current?.focus()
      return
    }
    const occasion = note.trim()
    void submit({
      email: address,
      clientName: name,
      ...(occasion === '' ? {} : { note: occasion }),
      ...(eventDate === '' ? {} : { eventDate }),
      locale,
      website,
    }).then((status) => {
      if (status !== null) navigate('/signup/sent', { state: { status } })
    })
  }

  return (
    <AuthForm
      title={t.signup.title}
      intro={t.signup.intro}
      error={error}
      submitting={submitting}
      submitLabel={t.signup.submit}
      onSubmit={handleSubmit}
      footer={
        <div className={styles['footer']}>
          <p className={styles['notice']}>
            {t.signup.notice}
            {links.privacy === undefined ? null : (
              <>
                {' '}
                <NewTabLink href={links.privacy}>{t.about.privacyLink}</NewTabLink>
              </>
            )}
          </p>
          <span>
            {t.signup.haveAccount} <Link to="/login">{t.auth.backToLogin}</Link>
          </span>
        </div>
      }
    >
      <Field label={t.auth.email} {...(malformed ? { error: t.errors['email.malformed'] } : {})}>
        {(control) => (
          <TextInput
            {...control}
            ref={emailBox}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="off"
            spellCheck={false}
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setMalformed(false)
            }}
          />
        )}
      </Field>

      <Field
        label={t.signup.clientName}
        hint={t.signup.clientNameHint}
        {...(nameMissing ? { error: t.signup.clientNameMissing } : {})}
      >
        {(control) => (
          <TextInput
            {...control}
            ref={nameBox}
            name="clientName"
            autoComplete="off"
            maxLength={CLIENT_NAME_MAX}
            required
            value={clientName}
            onChange={(event) => {
              setClientName(event.target.value)
              setNameMissing(false)
            }}
          />
        )}
      </Field>

      <Field label={t.signup.note} hint={t.signup.noteHint} optional>
        {(control) => (
          <Textarea
            {...control}
            name="note"
            maxLength={NOTE_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </Field>

      <Field
        label={t.signup.eventDate}
        optional
        {...(dateOutOfRange ? { error: t.signup.eventDateOutOfRange } : {})}
      >
        {(control) => (
          <TextInput
            {...control}
            ref={dateBox}
            type="date"
            name="eventDate"
            min={dateBounds.min}
            max={dateBounds.max}
            value={eventDate}
            onChange={(event) => {
              setEventDate(event.target.value)
              setDateOutOfRange(false)
            }}
          />
        )}
      </Field>

      {/* The trap: not translated, and never reachable by a person (see the stylesheet). */}
      <div className={styles['trap']} aria-hidden="true" inert>
        <label>
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            // A token no password manager or browser fills: `off` is ignored by many of them, and a
            // person whose browser filled this box would be taken for a bot.
            autoComplete="one-time-code"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </label>
      </div>
    </AuthForm>
  )
}
