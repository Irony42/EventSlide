import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { HostBreadcrumb } from '../../app/HostBreadcrumb'
import { HostEventsLink } from '../../app/HostEventsLink'
import { LoadFailure, Pending } from '../../design-system/components/Async'
import { Button } from '../../design-system/components/Button'
import { Notice } from '../../design-system/components/Notice'
import { LOCALE_NAMES, SUPPORTED_LOCALES, parseLocale, type Locale } from '../../lib/i18n/locale'
import { useTranslations } from '../../lib/i18n/useTranslations'
import { SelectField, type SelectOption } from './components/SelectField'
import { useEvent } from './hooks/useEventData'
import { useRevalidateWhenVisible } from './hooks/useRevalidateWhenVisible'
import { PrintSheet } from './print/PrintSheet'
import { usePrintPageRule } from './print/usePrintPageRule'
import {
  DEFAULT_PRINT_FORMAT,
  DEFAULT_PRINT_INK,
  PRINT_FORMATS,
  PRINT_INKS,
  availabilityOf,
  isQrTooSmall,
  type PrintFormat,
  type PrintInk,
} from './print/printKit'
import { readPrintPreferences, writePrintPreferences } from './print/printPreferences'
import styles from './PrintKitPage.module.css'
import type { UiText } from '../../lib/i18n/translations'

/** Each language named in itself, as on the settings page: the host picks the word the room reads. */
const LANGUAGE_OPTIONS: readonly SelectOption[] = SUPPORTED_LOCALES.map((locale) => ({
  value: locale,
  label: LOCALE_NAMES[locale],
}))

const INK_LABELS: Readonly<Record<PrintInk, (text: UiText) => string>> = {
  black: (text) => text.admin.printInkBlack,
  event: (text) => text.admin.printInkEvent,
}

const FORMAT_LABELS: Readonly<Record<PrintFormat, (text: UiText) => string>> = {
  a4: (text) => text.admin.printFormatA4,
  a5: (text) => text.admin.printFormatA5,
  card: (text) => text.admin.printFormatCard,
}

/**
 * Table cards and posters (spec 02): the sheet a host prints for the tables, drawn from the
 * event the server describes and printed by the browser's own dialog.
 *
 * Surface: the host and the moderator, on a laptop. The link and the code come from the
 * server (`joinUrl`), never from this page's address. Printing a code that may be stale is the
 * worst thing this page can do, so the button reloads the event first and prints only if that
 * worked; a direct Ctrl+P bypasses it, which the help text says.
 */
export function PrintKitPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const t = useTranslations()
  const { data: event, loading, error, reload } = useEvent(slug)

  const [preferences, setPreferences] = useState(() => readPrintPreferences(slug))
  const [totalModules, setTotalModules] = useState<number | null>(null)
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
  useRevalidateWhenVisible(reload)

  // The print waits for the reload it asked for, and never happens when that reload failed.
  useEffect(() => {
    if (!printWanted.current || loading) return
    printWanted.current = false
    if (error !== null) return
    // The effect runs after the commit that drew the reloaded sheet, so the dialog sees it.
    // Some in-app browsers ship no `print()`.
    if (typeof window.print === 'function') window.print()
  }, [loading, error])

  const handlePrint = () => {
    printWanted.current = true
    reload()
  }

  const update = useCallback(
    (patch: { format?: PrintFormat; language?: Locale; ink?: PrintInk }) => {
      const next = { ...preferences, ...patch }
      setPreferences(next)
      writePrintPreferences(slug, next)
    },
    [preferences, slug],
  )

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

  return (
    <div className={styles['page']}>
      <div className={styles['screenOnly']}>
        <HostBreadcrumb slug={slug} page="print" eventName={event.name} />
      </div>
      <h1 className={styles['title']}>{t.admin.printKitTitle}</h1>

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
        <>
          <div className={styles['controls']}>
            <p>{t.admin.printKitIntro}</p>
            {availability === 'closed' ? (
              <Notice tone="warning" role="status" variant="boxed">
                {t.admin.printKitClosed}
              </Notice>
            ) : null}
            {availability === 'draft' ? (
              <Notice tone="neutral" role="status" variant="boxed">
                {t.admin.printKitDraft}
              </Notice>
            ) : null}
            {codeChanged ? (
              <Notice tone="warning" role="status" variant="boxed">
                {t.admin.printKitCodeChanged}
              </Notice>
            ) : null}
            {error !== null ? (
              <Notice tone="danger" role="alert" variant="boxed">
                {error}{' '}
                <Button onClick={reload} disabled={loading}>
                  {t.app.retry}
                </Button>
              </Notice>
            ) : null}

            <fieldset className={styles['group']}>
              <legend className={styles['legend']}>{t.admin.printKitFormat}</legend>
              {PRINT_FORMATS.map((choice) => (
                <label key={choice} className={styles['radio']}>
                  <input
                    type="radio"
                    name="print-format"
                    value={choice}
                    checked={format === choice}
                    onChange={() => update({ format: choice })}
                  />
                  {FORMAT_LABELS[choice](t)}
                </label>
              ))}
            </fieldset>

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

            <fieldset className={styles['group']}>
              <legend className={styles['legend']}>{t.admin.printKitInk}</legend>
              {PRINT_INKS.map((choice) => (
                <label key={choice} className={styles['radio']}>
                  <input
                    type="radio"
                    name="print-ink"
                    value={choice}
                    checked={ink === choice}
                    onChange={() => update({ ink: choice })}
                  />
                  {INK_LABELS[choice](t)}
                </label>
              ))}
            </fieldset>

            {totalModules !== null && isQrTooSmall(format, totalModules) ? (
              <Notice tone="warning" role="status" variant="boxed">
                {t.admin.printKitLongLink}
              </Notice>
            ) : null}

            <Button variant="primary" onClick={handlePrint} disabled={loading}>
              {loading ? t.admin.printKitPrinting : t.admin.printKitPrint}
            </Button>
            <p className={styles['help']}>{t.admin.printKitHelp}</p>
          </div>

          <section className={styles['preview']} aria-label={t.admin.printKitPreview}>
            <PrintSheet
              eventName={event.name}
              joinUrl={event.joinUrl}
              joinCode={event.joinCode}
              format={format}
              locale={language}
              ink={ink}
              accentHue={event.settings.theme.accentHue}
              onQrModules={setTotalModules}
            />
          </section>
        </>
      )}
    </div>
  )
}
