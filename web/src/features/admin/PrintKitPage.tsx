import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { HostBreadcrumb } from '../../app/HostBreadcrumb'
import { HostEventsLink } from '../../app/HostEventsLink'
import { LoadFailure, Pending } from '../../design-system/components/Async'
import { Button } from '../../design-system/components/Button'
import { Icon } from '../../design-system/components/Icon'
import { IconButton } from '../../design-system/components/IconButton'
import { Notice } from '../../design-system/components/Notice'
import { SelectField, type SelectOption } from '../../design-system/components/SelectField'
import { cx } from '../../design-system/classNames'
import { LOCALE_NAMES, SUPPORTED_LOCALES, parseLocale } from '../../lib/i18n/locale'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { useEvent } from './hooks/useEventData'
import { useRevalidateWhenVisible } from './hooks/useRevalidateWhenVisible'
import { isEventLogoUrl } from '../../lib/brand'
import { PrintSheet } from './print/PrintSheet'
import {
  ColourPicker,
  DesignPicker,
  InkControls,
  PhotoControls,
  TextControls,
} from './print/PrintCardControls'
import { PRINT_PANEL_ID, PrintRail, printTabId } from './print/PrintRail'
import { FormatSegment, LanguageSelect, ViewToggle } from './print/PrintToolbarControls'
import {
  DEFAULT_PRINT_PANEL,
  defaultViewOf,
  type PrintPanel,
  type PrintView,
} from './print/printWorkshop'
import {
  DEFAULT_PRINT_DESIGN,
  inkLoadOf,
  qrShareOf,
  type PrintDesign,
  type PrintTextField,
} from '../../lib/print/printDesigns'
import { readPrintPhoto, writePrintPhoto } from './print/printPhoto'
import { useImageReady } from './print/useImageReady'
import { useMediaQuery } from './print/useMediaQuery'
import { usePhotoFraming } from './print/usePhotoFraming'
import { usePrintPageRule } from './print/usePrintPageRule'
import {
  DEFAULT_PRINT_FORMAT,
  DEFAULT_PRINT_INK,
  availabilityOf,
  hueOfHex,
  isQrTooSmall,
} from './print/printKit'
import {
  readPrintPreferences,
  writePrintPreferences,
  type PrintPreferences,
} from './print/printPreferences'
import styles from './PrintKitPage.module.css'

/** Each language named in itself, as on the settings page: the host picks the word the room reads. */
const LANGUAGE_OPTIONS: readonly SelectOption[] = SUPPORTED_LOCALES.map((locale) => ({
  value: locale,
  label: LOCALE_NAMES[locale],
}))

/** A phone: the canvas is pinned on top, the rail is a bar at the bottom, the settings sit between. */
const PHONE = '(max-width: 47.99rem)'

/**
 * Table cards and posters (spec 02, laid out as a workshop): the sheet a host prints for the
 * tables, drawn from the event the server describes and printed by the browser's own dialog.
 *
 * Surface: the host and the moderator, on a laptop first, on a phone too. The link and the code
 * come from the server (`joinUrl`), never from this page's address. Printing a code that may be
 * stale is the worst thing this page can do, so the button reloads the event first and prints only
 * if that worked; a direct Ctrl+P bypasses it, which the help text says.
 *
 * The preview never leaves the screen while a setting changes: on a laptop the workspace fills the
 * window and only the panel scrolls, on a phone the canvas is pinned on top.
 */
export function PrintKitPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  // Keyed by the event: its preferences and photograph are read once, when the page mounts, and
  // the router keeps the element when only the slug changes.
  return <EventPrintKit key={slug} slug={slug} />
}

function EventPrintKit({ slug }: { readonly slug: string }) {
  const t = useTranslations()
  const { data: event, loading, error, reload } = useEvent(slug)

  const [preferences, setPreferences] = useState(() => readPrintPreferences(slug))
  const [photoUrl, setPhotoUrl] = useState(() => readPrintPhoto(slug))
  const [totalModules, setTotalModules] = useState<number | null>(null)
  const panel: PrintPanel = preferences.panel ?? DEFAULT_PRINT_PANEL
  const [view, setView] = useState<PrintView>(() => defaultViewOf(panel))
  const [big, setBig] = useState(false)
  const phone = useMediaQuery(PHONE)
  const bigButton = useRef<HTMLButtonElement>(null)
  const closeBigButton = useRef<HTMLButtonElement>(null)
  // Set by the button, read once the reload it started has settled. A ref and not state: it
  // drives no rendering, only the one `print()` that follows the reload.
  const printWanted = useRef(false)
  const [seenCode, setSeenCode] = useState<string | null>(null)
  const [codeChanged, setCodeChanged] = useState(false)

  // The code the host first saw on this page, so a rotation elsewhere is announced.
  if (event !== null && event.joinCode !== seenCode) {
    if (seenCode !== null) setCodeChanged(true)
    setSeenCode(event.joinCode)
  }

  usePrintPageRule()
  const eventLogo = event?.settings.brand?.logoUrl
  const availableLogo = isEventLogoUrl(eventLogo) ? eventLogo : null
  const wantsLogo = preferences.logo === true && availableLogo !== null
  const logoState = useImageReady(wantsLogo ? availableLogo : null)
  useRevalidateWhenVisible(reload)

  // The print waits for the reload it asked for, and never happens when that reload failed.
  useEffect(() => {
    // A logo still on its way would print as an empty centre in a code encoded for it.
    if (!printWanted.current || loading || logoState === 'loading') return
    printWanted.current = false
    if (error !== null) return
    // The effect runs after the commit that drew the reloaded sheet, so the dialog sees it.
    // Some in-app browsers ship no `print()`.
    if (typeof window.print === 'function') window.print()
  }, [loading, error, logoState])

  // The full-screen preview is a phone's: it leaves on Escape, and when the window grows past a phone.
  const showingBig = big && phone
  useEffect(() => {
    if (!showingBig) return
    const onKey = (key: KeyboardEvent) => {
      if (key.key === 'Escape') setBig(false)
    }
    window.addEventListener('keydown', onKey)
    closeBigButton.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [showingBig])

  const handlePrint = () => {
    printWanted.current = true
    reload()
  }

  const update = useCallback(
    (patch: PrintPreferences) => {
      const next = { ...preferences, ...patch }
      setPreferences(next)
      writePrintPreferences(slug, next)
    },
    [preferences, slug],
  )

  const updateText = (field: PrintTextField, value: string) => {
    const texts = { ...preferences.texts }
    if (value === '') delete texts[field]
    else texts[field] = value
    update({ texts })
  }

  const updatePhoto = (url: string | null) => {
    setPhotoUrl(url)
    writePrintPhoto(slug, url)
  }

  const choosePanel = (next: PrintPanel) => {
    // The sheet is what the Impression entry is about; leaving it goes back to one card. Between the
    // other entries the host's own choice of view stays.
    if ((next === 'print') !== (panel === 'print')) setView(defaultViewOf(next))
    update({ panel: next })
  }

  const framing = usePhotoFraming({
    focusX: preferences.focusX ?? 50,
    focusY: preferences.focusY ?? 50,
    onFrame: (focusX, focusY) => update({ focusX, focusY }),
  })

  if (event === null && loading) return <Pending label={t.admin.eventLoading} />
  if (event === null) {
    return (
      <div className={styles['page']}>
        <HostBreadcrumb slug={slug} page="print" eventName={null} />
        <LoadFailure
          message={error ?? t.errors.unknown}
          onRetry={reload}
          as="h1"
          secondaryAction={<HostEventsLink />}
        />
      </div>
    )
  }

  const availability = availabilityOf(event.status)
  const format = preferences.format ?? DEFAULT_PRINT_FORMAT
  const ink = preferences.ink ?? DEFAULT_PRINT_INK
  const language = preferences.language ?? parseLocale(event.settings.wallLanguage) ?? 'fr'
  const design: PrintDesign = preferences.design ?? DEFAULT_PRINT_DESIGN
  const eventHue = event.settings.theme.accentHue
  const eventColour = `oklch(58% 0.14 ${eventHue})`
  const chosenColour = preferences.colour ?? null
  const accentHue = chosenColour === null ? eventHue : (hueOfHex(chosenColour) ?? eventHue)
  const typed = preferences.texts ?? {}
  const blankToNull = (value: string | undefined) =>
    value === undefined || value.trim() === '' ? null : value.trim()
  const texts = {
    title: blankToNull(typed.title) ?? event.name,
    tagline: blankToNull(typed.tagline),
    note: blankToNull(typed.note),
    date: blankToNull(typed.date),
    table: blankToNull(typed.table),
  }
  const steps = preferences.steps ?? true
  const focusX = preferences.focusX ?? 50
  const focusY = preferences.focusY ?? 50
  const longLink = totalModules !== null && isQrTooSmall(format, qrShareOf(design), totalModules)
  const heavyInk = inkLoadOf(design) === 'high'
  const landscape = format === 'a5' && view === 'sheet'

  const sheet = (single: boolean, onQrModules?: (modules: number | null) => void) => (
    <PrintSheet
      eventName={event.name}
      joinUrl={event.joinUrl}
      joinCode={event.joinCode}
      format={format}
      locale={language}
      ink={ink}
      accentHue={accentHue}
      colour={chosenColour ?? eventColour}
      logoUrl={wantsLogo && logoState === 'ready' ? availableLogo : null}
      design={design}
      texts={texts}
      steps={steps}
      photoUrl={photoUrl}
      focusX={focusX}
      focusY={focusY}
      single={single}
      {...(onQrModules === undefined ? {} : { onQrModules })}
    />
  )

  const formatControls = (
    <FormatSegment format={format} onFormat={(chosen) => update({ format: chosen })} />
  )

  const heavyInkNotice = heavyInk ? (
    <Notice tone="neutral" role="status" variant="boxed">
      {t.admin.printKitInkHeavy}
    </Notice>
  ) : null

  const panelBody: Record<PrintPanel, ReactNode> = {
    design: (
      <>
        <DesignPicker
          design={design}
          onDesign={(chosen) => update({ design: chosen })}
          previewTexts={texts}
          steps={steps}
          photoUrl={photoUrl}
          focusX={focusX}
          focusY={focusY}
          accentHue={accentHue}
          colour={chosenColour}
          eventColour={eventColour}
          locale={language}
        />
        {heavyInkNotice}
      </>
    ),
    texts: (
      <TextControls
        texts={typed}
        onText={updateText}
        eventName={event.name}
        steps={steps}
        onSteps={(on) => update({ steps: on })}
        previewTexts={texts}
      />
    ),
    photo: (
      <>
        <PhotoControls
          photoUrl={photoUrl}
          onPhoto={updatePhoto}
          focusX={focusX}
          focusY={focusY}
          onFocus={(axis, value) => update({ [axis]: value })}
        />
        {photoUrl === null ? null : <p className={styles['help']}>{t.admin.printPhotoDragHint}</p>}
      </>
    ),
    colours: (
      <>
        <ColourPicker
          colour={chosenColour}
          onColour={(colour) => {
            const { colour: _dropped, ...rest } = preferences
            const next = colour === null ? rest : { ...rest, colour }
            setPreferences(next)
            writePrintPreferences(slug, next)
          }}
          eventColour={eventColour}
        />
        <InkControls
          ink={ink}
          onInk={(chosen) => update({ ink: chosen })}
          logoAvailable={availableLogo !== null}
          logo={wantsLogo}
          onLogo={(on) => update({ logo: on })}
        />
        <p className={styles['help']}>{t.admin.printKitColoursHint}</p>
      </>
    ),
    print: (
      <>
        <p className={styles['help']}>{t.admin.printPanelPrintLead}</p>
        {phone ? (
          <>
            <div className={styles['group']}>
              <span className={styles['legend']}>{t.admin.printKitFormat}</span>
              {formatControls}
            </div>
            <SelectField
              label={t.admin.printKitLanguage}
              hint={t.admin.printKitLanguageHint}
              value={language}
              options={LANGUAGE_OPTIONS}
              onChange={(value) => {
                const chosen = parseLocale(value)
                if (chosen !== null) update({ language: chosen })
              }}
            />
          </>
        ) : null}
        <dl className={styles['summary']}>
          <dt>{t.admin.printKitDesign}</dt>
          <dd>{t.admin.printDesignNames[design]}</dd>
          <dt>{t.admin.printKitInk}</dt>
          <dd>{ink === 'black' ? t.admin.printInkBlack : t.admin.printInkEvent}</dd>
          <dt>{t.admin.printKitLanguage}</dt>
          <dd>{LOCALE_NAMES[language]}</dd>
        </dl>
        {heavyInkNotice}
        <p className={styles['help']}>{t.admin.printKitHelp}</p>
      </>
    ),
  }

  return (
    <div className={styles['page']}>
      <div className={styles['screenOnly']}>
        <HostBreadcrumb slug={slug} page="print" eventName={event.name} />
      </div>
      <div className={styles['head']}>
        <h1 className={styles['title']}>{t.admin.printKitTitle}</h1>
        {availability === 'unavailable' ? null : (
          <p className={styles['intro']}>{t.admin.printKitIntro}</p>
        )}
      </div>

      {availability === 'unavailable' ? (
        <div className={styles['screenOnly']}>
          <Notice tone="warning" role="status" variant="boxed">
            {t.admin.printKitArchived}
          </Notice>
          <Link className={styles['back']} to={`/admin/events/${slug}`}>
            {t.admin.printKitBack}
          </Link>
        </div>
      ) : (
        <div className={styles['workspace']} data-big={showingBig ? '' : undefined}>
          <div className={styles['rail']}>
            <PrintRail active={panel} onChange={choosePanel} />
          </div>

          <div
            role="tabpanel"
            id={PRINT_PANEL_ID}
            aria-labelledby={printTabId(panel)}
            className={styles['panel']}
          >
            <div className={styles['panelBody']}>{panelBody[panel]}</div>
          </div>

          <div className={styles['notices']}>
            {availability === 'closed' ? (
              <Notice tone="warning" role="status" variant="boxed" className={styles['slim']}>
                {t.admin.printKitClosed}
              </Notice>
            ) : null}
            {availability === 'draft' ? (
              <Notice tone="neutral" role="status" variant="boxed" className={styles['slim']}>
                {t.admin.printKitDraft}
              </Notice>
            ) : null}
            {codeChanged ? (
              <Notice tone="warning" role="status" variant="boxed" className={styles['slim']}>
                {t.admin.printKitCodeChanged}
              </Notice>
            ) : null}
            {longLink ? (
              <Notice tone="warning" role="status" variant="boxed" className={styles['slim']}>
                {t.admin.printKitLongLink}
              </Notice>
            ) : null}
            {error !== null ? (
              <Notice tone="danger" role="alert" variant="boxed" className={styles['slim']}>
                {error}{' '}
                <Button size="sm" onClick={reload} disabled={loading}>
                  {t.app.retry}
                </Button>
              </Notice>
            ) : null}
          </div>

          <div
            className={styles['canvas']}
            data-view={view}
            role={showingBig ? 'dialog' : undefined}
            aria-modal={showingBig ? true : undefined}
            aria-label={showingBig ? t.admin.printKitPreview : undefined}
          >
            <div className={styles['toolbar']} role="group" aria-label={t.admin.printToolbarLabel}>
              {phone ? null : (
                <div className={styles['toolGroup']}>
                  {formatControls}
                  <LanguageSelect
                    language={language}
                    onLanguage={(chosen) => update({ language: chosen })}
                  />
                </div>
              )}
              <div className={cx(styles['toolGroup'], styles['toolEnd'])}>
                <ViewToggle view={view} onView={setView} />
                {phone ? (
                  showingBig ? (
                    <IconButton
                      ref={closeBigButton}
                      variant="solid"
                      aria-label={t.admin.printCloseBig}
                      title={t.admin.printCloseBig}
                      icon={<Icon name="close" />}
                      onClick={() => {
                        setBig(false)
                        bigButton.current?.focus()
                      }}
                    />
                  ) : (
                    <IconButton
                      ref={bigButton}
                      variant="solid"
                      aria-label={t.admin.printSeeBig}
                      title={t.admin.printSeeBig}
                      icon={<Icon name="fullscreen" />}
                      onClick={() => setBig(true)}
                    />
                  )
                ) : null}
                <Button variant="primary" onClick={handlePrint} disabled={loading}>
                  {loading ? t.admin.printKitPrinting : t.admin.printKitPrint}
                </Button>
              </div>
            </div>

            <section
              className={cx(styles['fit'], styles['preview'])}
              aria-label={t.admin.printKitPreview}
              data-print={view === 'sheet' ? 'sheet' : 'off'}
              {...framing}
            >
              <div
                className={styles['frame']}
                data-landscape={landscape ? '' : undefined}
                data-framing={photoUrl === null ? undefined : ''}
              >
                {sheet(view === 'card', setTotalModules)}
              </div>
            </section>

            {view === 'card' ? (
              // The paper always carries the sheet, whatever the preview shows. It is laid out, so
              // the text fitting can measure it, but invisible on screen.
              <div className={cx(styles['printCopy'], styles['preview'])} data-print="sheet">
                {sheet(false)}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
