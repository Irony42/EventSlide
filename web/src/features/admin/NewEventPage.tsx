import { useId, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../../design-system/components/Button'
import { Field } from '../../design-system/components/Field'
import { Notice } from '../../design-system/components/Notice'
import { TextInput } from '../../design-system/components/TextInput'
import { useToast } from '../../design-system/components/useToast'
import { useLocale, useTranslations } from '../../lib/i18n/useTranslations'
import { slugify } from '../../lib/slugify'
import { eventCreationBlocked } from './ceilingLevels'
import { CeilingBanner } from './components/CeilingBanner'
import { EventTemplatePicker } from './components/EventTemplatePicker'
import { SuspensionScreen } from './components/SuspensionScreen'
import { useClientLimits } from './hooks/useClientLimits'
import { useCreateEvent } from './hooks/useEventActions'
import styles from './NewEventPage.module.css'
import type { EventTemplateKey } from '../../lib/api/dto'

/** Surface: the host's laptop, usually the day before the event. */
export function NewEventPage() {
  const t = useTranslations()
  const { locale } = useLocale()
  const create = useCreateEvent()
  const { clients, contact } = useClientLimits()
  const suspended = clients.some((client) => client.suspended)
  // The refusal is a `409` after the fact and its sentence used to appear under the template list,
  // below the fold. Said here, before the press, and the button stays out of reach until it could work.
  const blocked = eventCreationBlocked(clients)
  const blockedReason = useId()
  const toast = useToast()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  /** `null` is "Sans modèle", which is what a host who does not choose one gets. */
  const [template, setTemplate] = useState<EventTemplateKey | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  /**
   * Whether the host wrote an address of their own. A box holding only spaces did not: the
   * form sends none and the server derives one from the name, so the preview and the
   * submit below ask this one question rather than two that differ by a `trim`.
   */
  const ownSlug = slug.trim().length > 0

  /**
   * What the address will be.
   *
   * Derived with the same function the server uses when `slug` is left out, so the
   * preview cannot promise an address the server will not give. A host who types their
   * own slug sees theirs folded the same way, because that is what gets stored.
   */
  const preview = slugify(ownSlug ? slug : name)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFailure(null)

    void create
      .run('create', {
        name: name.trim(),
        // Absent, not empty: the server derives the slug from the name when the field
        // is omitted, and an empty string would be a validation failure instead.
        ...(ownSlug ? { slug: slugify(slug) } : {}),
        // Same shape and the same reason. There is no "no template" value on the wire —
        // absence is what says it — so nothing is sent when the host picked none.
        ...(template === null ? {} : { template }),
        // The language this host is reading, right now, which becomes the language of the
        // projector in the room (roadmap 1.5). Read once here and stored on the event —
        // nothing consults the preference again, so a host who later switches their own
        // browser has not moved a screen two hundred people are looking at. The settings
        // page is where they change it deliberately.
        wallLanguage: locale,
      })
      .then((result) => {
        if (!result.ok) {
          setFailure(result.message)
          return
        }
        toast.show(t.admin.eventCreated(result.value.name), { tone: 'success' })
        navigate(`/admin/events/${result.value.slug}`, { replace: true })
      })
  }

  return (
    <div className={styles['page']}>
      <h1 className={styles['title']}>{t.admin.newEvent}</h1>

      {/* A suspended account cannot create: it is told so here, before it fills a form the server
          would refuse (`403 client.suspended`), and the form is not offered. Otherwise the limits
          that are close come first, because the refusal of a ceiling is a `409` after the fact. */}
      {suspended ? (
        <SuspensionScreen contact={contact} />
      ) : (
        <>
          {clients.map((client) => (
            <CeilingBanner key={client.id} limits={client} contact={contact} />
          ))}

          <form className={styles['form']} onSubmit={handleSubmit} noValidate>
            <Field label={t.admin.eventName} hint={t.admin.eventNameHint}>
              {(control) => (
                <TextInput
                  {...control}
                  name="name"
                  autoComplete="off"
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </Field>

            {/* The hint already opens with "Facultatif", so `Field`'s own optional marker
            would say it twice in the same breath. */}
            <Field label={t.admin.slug} hint={t.admin.slugHint}>
              {(control) => (
                <TextInput
                  {...control}
                  name="slug"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                />
              )}
            </Field>

            {/*
          The region is mounted from the start, empty or not: a live region announces
          changes to content it already had, and one created at the same moment as its
          text is silent.
        */}
            <div className={styles['preview']} aria-live="polite">
              <span className={styles['previewLabel']}>{t.admin.slugPreviewLabel}</span>
              {preview.length === 0 ? (
                <span className={styles['previewEmpty']}>{t.admin.slugPreviewEmpty}</span>
              ) : (
                <span className={styles['previewValue']}>{`/e/${preview}`}</span>
              )}
            </div>

            {/*
          After the address rather than before it: the name is what the form is for and
          the address is derived from it, so the two stay together at the top and the
          policy decision — which is optional, and which the host may not have an opinion
          about — comes last.
        */}
            <EventTemplatePicker value={template} disabled={create.busy} onChange={setTemplate} />

            {failure === null ? null : (
              <Notice tone="danger" role="alert" variant="boxed">
                {failure}
              </Notice>
            )}

            {blocked ? (
              <Notice tone="warning" variant="boxed">
                <span id={blockedReason}>{t.errors['client.ceilingReached']}</span>
              </Notice>
            ) : null}

            <div className={styles['actions']}>
              <Button
                type="submit"
                variant="primary"
                loading={create.busy}
                disabled={blocked}
                {...(blocked ? { 'aria-describedby': blockedReason } : {})}
              >
                {t.admin.create}
              </Button>
              <Link to="/admin">{t.app.cancel}</Link>
            </div>
          </form>
        </>
      )}
    </div>
  )
}
