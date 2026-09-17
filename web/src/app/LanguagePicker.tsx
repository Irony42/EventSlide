import { LOCALE_NAMES, SUPPORTED_LOCALES, parseLocale } from '../lib/i18n/locale'
import { useLocale } from '../lib/i18n/useTranslations'
import styles from './LanguagePicker.module.css'
import type { ChangeEvent } from 'react'

/**
 * The manual override, on the guest surface and nowhere else.
 *
 * Surface: the **guest**. It is rendered by `GuestLayout`, so it is on the join screen
 * and on the upload screen and on neither the host console nor the wall — a host has one
 * language by the argument in `web/src/lib/i18n/translations.ts`, and a wall has two
 * hundred people in front of it and no way to ask them.
 *
 * Three decisions in a very small component:
 *
 * 1. **The options are endonyms.** "Deutsch", never "Allemand" — the whole point is to
 *    be usable by somebody who cannot read the language the page is currently in.
 * 2. **No flags.** A flag is a country and a language is not one; Spanish is not Spain,
 *    and German is not only Germany.
 * 3. **The accessible name is translated.** Nothing is drawn beside the control — it
 *    shows the language it is set to, which is label enough to look at — but `aria-label`
 *    is what a screen-reader user hears, and hearing "Langue" when the page is in German
 *    is the same failure this picker exists to fix.
 *
 * Changing the value persists it immediately. There is no Save: a guest who has found
 * the language list has already told you what they want, and an extra tap on a phone in
 * a dark room is an extra chance to give up.
 */
export function LanguagePicker() {
  const { locale, text, setLocale } = useLocale()

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    // Parsed rather than cast. The value comes back from the DOM as a bare string, and
    // this is the same boundary rule the stored preference goes through — a `<select>`
    // whose options an extension rewrote must not be able to set a locale that has no
    // table.
    const chosen = parseLocale(event.target.value)
    if (chosen !== null) setLocale(chosen)
  }

  return (
    <div className={styles['picker']}>
      <select
        className={styles['select']}
        aria-label={text.app.language}
        value={locale}
        onChange={handleChange}
      >
        {SUPPORTED_LOCALES.map((supported) => (
          <option key={supported} value={supported}>
            {LOCALE_NAMES[supported]}
          </option>
        ))}
      </select>
    </div>
  )
}
