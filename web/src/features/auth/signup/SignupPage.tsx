import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Field } from '../../../design-system/components/Field'
import { NewTabLink } from '../../../design-system/components/NewTabLink'
import { Textarea } from '../../../design-system/components/Textarea'
import { TextInput } from '../../../design-system/components/TextInput'
import { parseLocale } from '../../../lib/i18n/locale'
import { useLocale } from '../../../lib/i18n/useTranslations'
import { useAbout, useAboutHeard } from '../../../lib/useAbout'
import { AuthForm } from '../components/AuthForm'
import { AuthActions, AuthPage } from '../components/AuthPage'
import { useRequestSignup } from './hooks/useSignup'
import styles from './SignupPage.module.css'

/** The limits the server enforces (spec 31 §3), applied here so the box says so before it is sent. */
const CLIENT_NAME_MAX = 80
const NOTE_MAX = 300

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
  const { locale, text: t, setLocale } = useLocale()
  const { submit, submitting, error } = useRequestSignup()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { features, links } = useAbout()
  const heard = useAboutHeard()

  const [email, setEmail] = useState('')
  const [clientName, setClientName] = useState('')
  const [note, setNote] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [website, setWebsite] = useState('')
  const [malformed, setMalformed] = useState(false)
  const [nameMissing, setNameMissing] = useState(false)

  // `?lang=` preselects the language, once per value: a visitor who then picks another in the
  // header is not taken back. An unknown value is ignored.
  const asked = parseLocale(params.get('lang'))
  useEffect(() => {
    if (asked !== null) setLocale(asked)
    // `setLocale` is not stable across renders and must not re-apply the address's language
    // over the picker's choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked])

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
    setMalformed(badAddress)
    setNameMissing(name === '')
    if (badAddress || name === '') return
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

      <Field label={t.signup.eventDate} optional>
        {(control) => (
          <TextInput
            {...control}
            type="date"
            name="eventDate"
            value={eventDate}
            onChange={(event) => setEventDate(event.target.value)}
          />
        )}
      </Field>

      {/* The trap: not translated, and never reachable by a person (see the stylesheet). */}
      <div className={styles['trap']} aria-hidden="true">
        <label>
          Website
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </label>
      </div>
    </AuthForm>
  )
}
