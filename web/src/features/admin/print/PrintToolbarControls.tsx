import { LOCALE_NAMES, SUPPORTED_LOCALES, parseLocale, type Locale } from '../../../lib/i18n/locale'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import type { UiText } from '../../../lib/i18n/translations'
import { PRINT_FORMATS, type PrintFormat } from './printKit'
import type { PrintView } from './printWorkshop'
import styles from './PrintToolbarControls.module.css'

const SHORT_FORMAT: Readonly<Record<PrintFormat, (text: UiText) => string>> = {
  card: (text) => text.admin.printFormatShortCard,
  a5: (text) => text.admin.printFormatShortA5,
  a4: (text) => text.admin.printFormatShortA4,
}

const LONG_FORMAT: Readonly<Record<PrintFormat, (text: UiText) => string>> = {
  card: (text) => text.admin.printFormatCard,
  a5: (text) => text.admin.printFormatA5,
  a4: (text) => text.admin.printFormatA4,
}

/** The three formats as one segmented control: radios underneath, so the arrows and a screen reader work. */
export function FormatSegment({
  format,
  onFormat,
}: {
  readonly format: PrintFormat
  readonly onFormat: (format: PrintFormat) => void
}) {
  const t = useTranslations()
  return (
    <div role="radiogroup" aria-label={t.admin.printKitFormat} className={styles['segment']}>
      {PRINT_FORMATS.map((choice) => (
        <label key={choice} className={styles['option']} title={LONG_FORMAT[choice](t)}>
          <input
            type="radio"
            name="print-format"
            value={choice}
            checked={format === choice}
            onChange={() => onFormat(choice)}
            className={styles['optionInput']}
          />
          <span>{SHORT_FORMAT[choice](t)}</span>
        </label>
      ))}
    </div>
  )
}

/** Each language named in itself: the host picks the word the room reads, not the console's. */
export function LanguageSelect({
  language,
  onLanguage,
}: {
  readonly language: Locale
  readonly onLanguage: (language: Locale) => void
}) {
  const t = useTranslations()
  return (
    <label className={styles['language']}>
      <span className={styles['languageLabel']}>{t.admin.printKitLanguage}</span>
      <select
        className={styles['select']}
        value={language}
        onChange={(event) => {
          const chosen = parseLocale(event.target.value)
          if (chosen !== null) onLanguage(chosen)
        }}
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {LOCALE_NAMES[locale]}
          </option>
        ))}
      </select>
    </label>
  )
}

/** One card big, or the whole sheet with its cut marks. */
export function ViewToggle({
  view,
  onView,
}: {
  readonly view: PrintView
  readonly onView: (view: PrintView) => void
}) {
  const t = useTranslations()
  const entries: readonly (readonly [PrintView, string])[] = [
    ['card', t.admin.printViewCard],
    ['sheet', t.admin.printViewSheet],
  ]
  return (
    <div role="group" aria-label={t.admin.printViewLabel} className={styles['segment']}>
      {entries.map(([choice, label]) => (
        <button
          key={choice}
          type="button"
          aria-pressed={view === choice}
          className={styles['toggle']}
          onClick={() => onView(choice)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
