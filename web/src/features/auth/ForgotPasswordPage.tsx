import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Field } from '../../design-system/components/Field'
import { TextInput } from '../../design-system/components/TextInput'
import { useLocale } from '../../lib/i18n/useTranslations'
import { AuthActions, AuthPage } from './components/AuthPage'
import { AuthForm } from './components/AuthForm'
import { useRequestPasswordReset } from './hooks/usePasswordReset'

/**
 * Something that could be an address: a local part, an `@`, and a domain with a dot in it, which
 * is the shape the server asks of one (`EmailAddress`) and no more.
 *
 * A typo such as `camille.example.com` or `camille@gmail` would otherwise be answered "check
 * your inbox" for a message that was never going to exist, which is the cruellest answer this
 * page can give: the server answers `202` for a string that cannot be an address too, so
 * without this check the person would wait for a mail that no relay was ever asked to send. It
 * is a check on what was typed, not on whether the address is anybody's: **the server's answer
 * is the same for every address that could be one, and this page must not learn otherwise.**
 */
const LOOKS_LIKE_AN_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * `/password/forgot` (roadmap G2-08 / G2-10): ask for a link by e-mail.
 *
 * Surface: **the host or the invitee who has lost the way back in**, reached from the sign-in
 * page — which offers it only when `features.forgotPassword` says the box can send mail.
 * Typing the address is the whole screen, and the answer is always the same one.
 *
 * **Always the same answer** is the property that matters. `POST /api/auth/password-reset/request`
 * is `202 {}` for an account, a stranger's address, a switched-off account and one that has been
 * mailed three times this hour; so this page shows the one confirmation, in the same words, for
 * all of them. (A string that cannot be an address never leaves the page, see above.) Anything this page did differently by address would turn a
 * form open to the whole internet into a way to list who has an account here.
 *
 * Not gated on `features.forgotPassword`: that flag is the sign-in page's reason to *offer* the
 * link, but a bookmark or an old mail can still land here, and the server is the judge of
 * whether the box can mail — a `404 feature.unavailable` is answered in a sentence of its own.
 */
export function ForgotPasswordPage() {
  const { locale, text: t } = useLocale()
  const { submit, submitting, error } = useRequestPasswordReset()
  const [email, setEmail] = useState('')
  const [malformed, setMalformed] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = () => {
    if (!LOOKS_LIKE_AN_ADDRESS.test(email.trim())) {
      setMalformed(true)
      return
    }
    setMalformed(false)
    // The page's language is the mail's: the person is reading this one.
    void submit(email.trim(), locale).then((taken) => {
      if (taken) setSent(true)
    })
  }

  if (sent) {
    return (
      <AuthPage title={t.auth.forgotSentTitle} intro={t.auth.forgotSent} focusTitle>
        <AuthActions>
          <Link to="/login">{t.auth.backToLogin}</Link>
        </AuthActions>
      </AuthPage>
    )
  }

  return (
    <AuthForm
      title={t.auth.forgotTitle}
      intro={t.auth.forgotIntro}
      error={error}
      submitting={submitting}
      submitLabel={t.auth.forgotSubmit}
      onSubmit={handleSubmit}
      footer={<Link to="/login">{t.auth.backToLogin}</Link>}
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
    </AuthForm>
  )
}
