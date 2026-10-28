import { useId, useState, type CSSProperties, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { HostBreadcrumb } from '../../app/HostBreadcrumb'
import { HostEventsLink } from '../../app/HostEventsLink'
import { Button } from '../../design-system/components/Button'
import { LoadFailure, Pending } from '../../design-system/components/Async'
import { Notice } from '../../design-system/components/Notice'
import { useToast } from '../../design-system/components/useToast'
import {
  CURATED_ACCENT_HUES,
  CURATED_ACCENT_NAMES,
  DEFAULT_EVENT_THEME,
  THEME_FACES,
  THEME_GROUNDS,
} from '../../design-system/eventTheme'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { AmbiancePreview } from './components/AmbiancePreview'
import { VenuePhotoField } from './components/VenuePhotoField'
import { draftIdentity, draftTheme, HUE_MAX, HUE_MIN, initialCustom } from './customAmbianceDraft'
import { isMutable } from './eventLifecycle'
import { useSaveSettings } from './hooks/useEventActions'
import { useEvent } from './hooks/useEventData'
import { toSettingsPatch } from './settingsPayload'
import styles from './CustomAmbiancePage.module.css'
import type { ThemeCustom, ThemeFaces, ThemeGround } from '../../lib/api/dto'

interface Draft {
  readonly custom: ThemeCustom
  readonly accentHue: number
}

/**
 * The simulation page of a host's own ambiance (ADR 0011, decisions 6 and 7):
 * `/admin/events/:slug/settings/ambiance`.
 *
 * Surface: **the host's laptop**, before the event. It serves the guest's phone and the room,
 * which are what the previews draw.
 *
 * Nothing is stored until Enregistrer, which is the existing `PATCH /settings`. A draft the
 * server refuses is **shown refused, not corrected**: the sliders keep the host's angle, the
 * previews keep wearing it, and the sentence beside the button says why it was not saved. The
 * page itself keeps wearing the event's *saved* look (the breadcrumb's marker), because the
 * previews carry `data-template-preview`.
 */
export function CustomAmbiancePage() {
  const t = useTranslations()
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { data: event, loading, error, reload, replace } = useEvent(slug)
  const save = useSaveSettings()

  const [draft, setDraft] = useState<Draft | null>(null)
  const [syncedFrom, setSyncedFrom] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  // Reset when the server's answer genuinely changed, adjusted during render as the settings
  // page does; a refetch with the same values keeps what the host is moving.
  if (event !== null && draftIdentity(event.settings.theme) !== syncedFrom) {
    setSyncedFrom(draftIdentity(event.settings.theme))
    setDraft({
      custom: initialCustom(event.settings.theme),
      accentHue: event.settings.theme.accentHue,
    })
  }

  if (event === null || draft === null) {
    if (loading) return <Pending label={t.admin.eventLoading} />
    return (
      <div className={styles['page']}>
        <HostBreadcrumb slug={slug} page="ambiance" eventName={null} />
        <LoadFailure
          message={error ?? t.errors.unknown}
          onRetry={reload}
          as="h1"
          secondaryAction={<HostEventsLink />}
        />
      </div>
    )
  }

  const archived = !isMutable(event.status)
  const ownerOnly = event.role !== 'owner'
  const readOnly = archived || ownerOnly
  const settingsPath = `/admin/events/${encodeURIComponent(slug)}/settings`
  const theme = draftTheme(event.settings.theme, draft.custom, draft.accentHue)

  // A refusal is about the draft it was given; once the host moves anything it is stale.
  const setCustom = (patch: Partial<ThemeCustom>) => {
    setFailure(null)
    setDraft({ ...draft, custom: { ...draft.custom, ...patch } })
  }

  const handleSubmit = (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault()
    if (readOnly || save.busy) return
    setFailure(null)
    void save.run('save', slug, toSettingsPatch({ ...event.settings, theme })).then((result) => {
      if (!result.ok) {
        // The draft is not touched: the host sees their own angle, refused, and moves it.
        setFailure(result.message)
        return
      }
      replace(result.value)
      toast.show(t.admin.customSaved, { tone: 'success' })
      navigate(settingsPath)
    })
  }

  const groundNames: Record<ThemeGround, string> = t.admin.customGroundNames

  return (
    <div className={styles['page']}>
      <HostBreadcrumb
        slug={event.slug}
        page="ambiance"
        eventName={event.name}
        ambiance={event.settings.theme.ambiance}
        custom={event.settings.theme.custom}
        groundUrl={event.settings.theme.groundUrl}
      />
      <h1 className={styles['title']}>{t.admin.customAmbianceTitle}</h1>
      <p className={styles['intro']}>{t.admin.customAmbianceIntro}</p>

      {readOnly ? (
        <p className={styles['notice']}>
          {archived ? t.admin.settingsReadOnly : t.admin.settingsOwnerOnly}
        </p>
      ) : null}

      <div className={styles['layout']}>
        <form className={styles['controls']} onSubmit={handleSubmit} noValidate>
          <fieldset className={styles['group']}>
            <legend className={styles['legend']}>{t.admin.customGround}</legend>
            {THEME_GROUNDS.map((ground) => (
              <label key={ground} className={styles['choice']}>
                <input
                  type="radio"
                  className={styles['radio']}
                  name="customGround"
                  value={ground}
                  checked={draft.custom.ground === ground}
                  disabled={readOnly}
                  onChange={() => setCustom({ ground })}
                />
                {groundNames[ground]}
              </label>
            ))}
          </fieldset>

          <HueSlider
            label={t.admin.customGroundHue}
            hint={t.admin.customGroundHueHint}
            value={draft.custom.groundHue}
            disabled={readOnly}
            onChange={(groundHue) => setCustom({ groundHue })}
          />

          <HueSlider
            label={t.admin.customAccentHue}
            hint={t.admin.customAccentHueHint}
            value={draft.accentHue}
            disabled={readOnly}
            onChange={(accentHue) => {
              setFailure(null)
              setDraft({ ...draft, accentHue })
            }}
            swatch
          />

          {/* The four curated accents, a click away: hues the server is known to accept. */}
          <div className={styles['swatches']}>
            {CURATED_ACCENT_NAMES.map((name) => (
              <Button
                key={name}
                size="sm"
                variant="ghost"
                disabled={readOnly}
                aria-pressed={draft.accentHue === CURATED_ACCENT_HUES[name]}
                data-event-accent={
                  CURATED_ACCENT_HUES[name] === DEFAULT_EVENT_THEME.accentHue
                    ? undefined
                    : String(CURATED_ACCENT_HUES[name])
                }
                onClick={() => {
                  setFailure(null)
                  setDraft({ ...draft, accentHue: CURATED_ACCENT_HUES[name] })
                }}
              >
                {t.admin.themeAccentNames[name]}
              </Button>
            ))}
          </div>

          <fieldset className={styles['group']}>
            <legend className={styles['legend']}>{t.admin.customFaces}</legend>
            <p className={styles['hint']}>{t.admin.customFacesHint}</p>
            {THEME_FACES.map((faces: ThemeFaces) => (
              <label key={faces} className={styles['choice']}>
                <input
                  type="radio"
                  className={styles['radio']}
                  name="customFaces"
                  value={faces}
                  checked={draft.custom.faces === faces}
                  disabled={readOnly}
                  onChange={() => setCustom({ faces })}
                />
                {/* The option is drawn in its own face: `tokens.css` re-declares
                    `--font-display` for this attribute on this very element. */}
                <span
                  className={styles['face']}
                  data-ambiance-faces={faces}
                  data-template-preview="faces"
                >
                  <span className={styles['faceName']}>{t.admin.themeAmbianceNames[faces]}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <VenuePhotoField
            slug={slug}
            groundUrl={event.settings.theme.groundUrl}
            disabled={readOnly}
            onChanged={replace}
          />

          {failure === null ? null : (
            <Notice tone="danger" role="alert" variant="boxed">
              {failure} {t.admin.customKept}
            </Notice>
          )}

          <div className={styles['actions']}>
            <Button type="submit" variant="primary" loading={save.busy} disabled={readOnly}>
              {t.app.save}
            </Button>
            <Button variant="ghost" onClick={() => navigate(settingsPath)}>
              {t.app.cancel}
            </Button>
          </div>
        </form>

        <section className={styles['preview']} aria-labelledby="custom-preview-title">
          <h2 id="custom-preview-title" className={styles['previewTitle']}>
            {t.admin.customPreview}
          </h2>
          <p className={styles['hint']}>{t.admin.customPreviewHint}</p>
          <AmbiancePreview
            theme={theme}
            eventName={event.name}
            join={{ code: event.joinCode, url: event.joinUrl }}
          />
        </section>
      </div>
    </div>
  )
}

interface HueSliderProps {
  readonly label: string
  readonly hint: string
  readonly value: number
  readonly disabled: boolean
  readonly onChange: (value: number) => void
  /** Draws the accent this angle makes, beside its value. */
  readonly swatch?: boolean
}

/** A labelled range with its value written out: the angle is never only a position. */
function HueSlider({ label, hint, value, disabled, onChange, swatch = false }: HueSliderProps) {
  const id = useId()
  return (
    <div className={styles['group']}>
      <label htmlFor={id} className={styles['legend']}>
        {label}
      </label>
      <div className={styles['sliderRow']}>
        <input
          id={id}
          type="range"
          className={styles['slider']}
          min={HUE_MIN}
          max={HUE_MAX}
          step={1}
          value={value}
          disabled={disabled}
          aria-describedby={`${id}-hint`}
          onChange={(changed) => onChange(Number(changed.target.value))}
        />
        {swatch ? (
          <span
            className={styles['swatch']}
            aria-hidden="true"
            data-event-accent={String(value)}
            style={swatchStyle(value)}
          />
        ) : null}
        <output htmlFor={id} className={styles['value']}>
          {value}°
        </output>
      </div>
      <p id={`${id}-hint`} className={styles['hint']}>
        {hint}
      </p>
    </div>
  )
}

type SwatchStyle = CSSProperties & { readonly '--accent-hue': string }
const swatchStyle = (hue: number): SwatchStyle => ({ '--accent-hue': String(hue) })
