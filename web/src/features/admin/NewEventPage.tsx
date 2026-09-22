import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../../design-system/components/Button'
import { Field } from '../../design-system/components/Field'
import { StatusIcon } from '../../design-system/components/StatusIcon'
import { TextInput } from '../../design-system/components/TextInput'
import { useToast } from '../../design-system/components/useToast'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { slugify } from '../../lib/slugify'
import { EventTemplatePicker } from './components/EventTemplatePicker'
import { useCreateEvent } from './hooks/useEventActions'
import styles from './NewEventPage.module.css'
import type { EventTemplateKey } from '../../lib/api/dto'

/** Surface: the host's laptop, usually the day before the event. */
export function NewEventPage() {
  const t = useTranslations()
  const create = useCreateEvent()
  const toast = useToast()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  /** `null` is "Sans modèle", which is what a host who does not choose one gets. */
  const [template, setTemplate] = useState<EventTemplateKey | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  /**
   * What the address will be.
   *
   * Derived with the same function the server uses when `slug` is left out, so the
   * preview cannot promise an address the server will not give. A host who types their
   * own slug sees theirs folded the same way, because that is what gets stored.
   */
  const preview = slugify(slug.length > 0 ? slug : name)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFailure(null)

    void create
      .run('create', {
        name: name.trim(),
        // Absent, not empty: the server derives the slug from the name when the field
        // is omitted, and an empty string would be a validation failure instead.
        ...(slug.trim().length > 0 ? { slug: slugify(slug) } : {}),
        // Same shape and the same reason. There is no "no template" value on the wire —
        // absence is what says it — so nothing is sent when the host picked none.
        ...(template === null ? {} : { template }),
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
          <p className={styles['alert']} role="alert">
            <span className={styles['alertGlyph']}>
              <StatusIcon tone="danger" />
            </span>
            {failure}
          </p>
        )}

        <div className={styles['actions']}>
          <Button type="submit" variant="primary" loading={create.busy}>
            {t.admin.create}
          </Button>
          <Link to="/admin">{t.app.cancel}</Link>
        </div>
      </form>
    </div>
  )
}
