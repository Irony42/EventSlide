import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { AmbiancePreview } from '../../app/AmbiancePreview'
import { HostBreadcrumb } from '../../app/HostBreadcrumb'
import { HostEventsLink } from '../../app/HostEventsLink'
import { useSharedReplace } from '../../app/eventChrome'
import { LoadFailure, Pending } from '../../design-system/components/Async'
import { Button } from '../../design-system/components/Button'
import { Dialog } from '../../design-system/components/Dialog'
import { Notice } from '../../design-system/components/Notice'
import { isMutable } from '../../lib/eventLifecycle'
import { messageForError } from '../../lib/i18n/translations'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { useSettingsAutosave } from '../../lib/useSettingsAutosave'
import { AccentSwatches } from './components/AccentSwatches'
import { AmbianceCards } from './components/AmbianceCards'
import { LogoField } from './components/LogoField'
import { ScreenDetails } from './components/ScreenDetails'
import { VenuePhotoField } from './components/VenuePhotoField'
import { WelcomeMessageField } from './components/WelcomeMessageField'
import { useEvent } from './hooks/useEventData'
import { useMediaQuery } from './print/useMediaQuery'
import { saveStatusLabel } from './settingsLabels'
import { settingsChanges } from './settingsPayload'
import styles from './AppearancePage.module.css'
import type { EventDto, EventSettingsDto } from '../../lib/api/dto'

/** Below this width the preview is a small strip above the page, and « Voir en grand » opens it whole. */
const NARROW = '(max-width: 56rem)'

/**
 * « Apparence »: what the guests see on their phones and what the room's screen shows, in one page
 * with its preview (Pierre, 25/11, mock-up B1 « Atelier »).
 *
 * Surface: **the host's laptop** (settings on the left, the preview sticky on the right) and the
 * host's phone (a small sticky strip above the settings). It serves the guest's phone and the room,
 * which are what the preview draws.
 *
 * It replaces the « Apparence » section of the settings page, with the same rules: every choice is
 * saved as it is made (`useSettingsAutosave`, no Save button), the owner alone changes anything, and
 * an archived event is shown and not changed, with the same sentence. The preview is fed the theme
 * the autosave holds, so it follows a click at once, ahead of the server's answer.
 */
export function AppearancePage() {
  const t = useTranslations()
  const { slug = '' } = useParams()
  const { data: event, loading, error, reload, replace: replaceOwn } = useEvent(slug)
  // What a save returns reaches the menu and the ambiance around the page too (eventLayout/).
  const replace = useSharedReplace(replaceOwn)

  if (event === null) {
    if (loading) return <Pending label={t.admin.eventLoading} />
    return (
      <div className={styles['page']}>
        <HostBreadcrumb slug={slug} page="appearance" eventName={null} />
        <LoadFailure
          message={error ?? t.errors.unknown}
          onRetry={reload}
          as="h1"
          secondaryAction={<HostEventsLink />}
        />
      </div>
    )
  }

  return <AppearanceSections event={event} error={error} replace={replace} />
}

interface AppearanceSectionsProps {
  readonly event: EventDto
  /** A refresh that failed while the host was reading: the page keeps what it had and says so. */
  readonly error: string | null
  readonly replace: (event: EventDto) => void
}

function AppearanceSections({ event, error, replace }: AppearanceSectionsProps) {
  const t = useTranslations()
  const copy = t.admin.appearance
  const slug = event.slug
  const autosave = useSettingsAutosave(slug, event, replace)
  const narrow = useMediaQuery(NARROW)
  const [large, setLarge] = useState(false)

  const settings = autosave.settings
  // Two reasons nothing can be changed, and the person is told which (as on the settings page):
  // the event is archived, or the viewer is a moderator, for whom the server refuses every
  // settings route.
  const archived = !isMutable(event.status)
  const ownerOnly = event.role !== 'owner'
  const readOnly = archived || ownerOnly

  // Every control is disabled while the page is read-only, so nothing calls this then.
  const update = (patch: Partial<EventSettingsDto>) =>
    autosave.save(settingsChanges({ ...settings, ...patch }, settings))

  const failure =
    autosave.state.kind === 'failed'
      ? `${t.admin.settingsPage.saveFailed} ${messageForError(autosave.state.cause, t)}`
      : null

  const theme = settings.theme
  const brand = {
    logoUrl: event.settings.brand?.logoUrl ?? null,
    // The pending overlay, so the message shows once the host leaves the field, before the answer.
    welcomeMessage: settings.brand?.welcomeMessage ?? null,
  }
  const join = { code: event.joinCode, url: event.joinUrl }

  return (
    <div className={styles['page']}>
      <HostBreadcrumb
        slug={slug}
        page="appearance"
        eventName={event.name}
        ambiance={event.settings.theme.ambiance}
        custom={event.settings.theme.custom}
        groundUrl={event.settings.theme.groundUrl}
      />
      <div className={styles['header']}>
        <h1 className={styles['title']}>{copy.title}</h1>
        {readOnly ? null : (
          <p className={styles['status']} aria-live="polite" data-state={autosave.state.kind}>
            {saveStatusLabel(autosave.state, t)}
          </p>
        )}
      </div>
      <p className={styles['lead']}>{copy.lead}</p>

      {readOnly ? (
        <p className={styles['notice']}>
          {archived ? t.admin.settingsReadOnly : t.admin.settingsOwnerOnly}
        </p>
      ) : null}

      {error === null ? null : (
        <Notice tone="warning" role="status" variant="boxed">
          {error}
        </Notice>
      )}

      {/* A change the server refused: the control is back to what it holds, and this says why. */}
      {failure === null ? null : (
        <Notice tone="danger" role="alert" variant="boxed">
          {failure}
        </Notice>
      )}

      <div className={styles['work']}>
        <div className={styles['settings']}>
          <section className={styles['group']} aria-labelledby="appearance-images">
            <h2 id="appearance-images" className={styles['groupTitle']}>
              {copy.imagesTitle}
            </h2>
            <p className={styles['help']}>{copy.imagesHelp}</p>
            <div className={styles['images']}>
              <LogoField
                slug={slug}
                logoUrl={event.settings.brand?.logoUrl}
                disabled={readOnly}
                onChanged={replace}
              />
              <VenuePhotoField
                slug={slug}
                groundUrl={event.settings.theme.groundUrl}
                disabled={readOnly}
                onChanged={replace}
              />
            </div>
          </section>

          <section className={styles['group']} aria-labelledby="appearance-ambiance">
            <h2 id="appearance-ambiance" className={styles['groupTitle']}>
              {copy.ambianceTitle}
            </h2>
            <p className={styles['help']}>{copy.ambianceHelp}</p>
            <AmbianceCards
              value={theme.ambiance}
              disabled={readOnly}
              customAmbiancePath={`/admin/events/${encodeURIComponent(slug)}/settings/ambiance`}
              onChange={(ambiance) => {
                // Leaving `custom` drops its object: the server refuses one beside another ambiance.
                const { custom: _dropped, ...rest } = theme
                update({ theme: { ...rest, ambiance } })
              }}
            />
          </section>

          <section className={styles['group']} aria-labelledby="appearance-colour">
            <h2 id="appearance-colour" className={styles['groupTitle']}>
              {copy.colourTitle}
            </h2>
            <p className={styles['help']}>{copy.colourHelp}</p>
            <AccentSwatches
              theme={theme}
              disabled={readOnly}
              onChange={(accentHue) => update({ theme: { ...theme, accentHue } })}
            />
          </section>

          <section className={styles['group']} aria-labelledby="appearance-message">
            <h2 id="appearance-message" className={styles['groupTitle']}>
              {copy.messageTitle}
            </h2>
            <WelcomeMessageField
              // The server's answer, not the pending overlay: a refused message must not be swapped
              // back into the field over what the host typed.
              value={event.settings.brand?.welcomeMessage ?? null}
              disabled={readOnly}
              hideLabel
              onChange={(welcomeMessage) =>
                update({ brand: { welcomeMessage, logoUrl: settings.brand?.logoUrl ?? null } })
              }
            />
          </section>

          <ScreenDetails
            theme={theme}
            disabled={readOnly}
            onChange={(next) => update({ theme: next })}
          />
        </div>

        <aside className={styles['preview']} aria-label={copy.previewTitle}>
          <div className={styles['previewHead']}>
            <h2 className={styles['previewTitle']}>{copy.previewTitle}</h2>
            {narrow ? (
              <Button size="sm" variant="secondary" onClick={() => setLarge(true)}>
                {copy.previewBig}
              </Button>
            ) : null}
          </div>
          <AmbiancePreview
            theme={theme}
            eventName={event.name}
            join={join}
            brand={brand}
            layout={narrow ? 'strip' : 'stack'}
          />
          {narrow ? null : <p className={styles['note']}>{copy.previewNote}</p>}
        </aside>
      </div>

      {/* The whole preview, on a phone: a panel of the design system with its own close and focus. */}
      <Dialog
        open={large && narrow}
        title={copy.previewTitle}
        onClose={() => setLarge(false)}
        className={styles['dialog']}
        footer={
          <Button variant="secondary" onClick={() => setLarge(false)}>
            {copy.previewClose}
          </Button>
        }
      >
        {large && narrow ? (
          <>
            <AmbiancePreview
              theme={theme}
              eventName={event.name}
              join={join}
              brand={brand}
              layout="stack"
            />
            <p className={styles['note']}>{copy.previewNote}</p>
          </>
        ) : null}
      </Dialog>
    </div>
  )
}
