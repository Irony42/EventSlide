import { SUPPORTED_LOCALES, type Locale } from '../../../lib/i18n/locale'
import { PRINT_FORMATS, PRINT_INKS, type PrintFormat, type PrintInk } from './printKit'

/**
 * What the host last chose on this device, per event.
 *
 * Style only: never the join code or the link in the value (a stored code would be a secret
 * that outlives its rotation), never the event's name. Read and written under `try/catch`:
 * a private window or blocked storage must leave the page working with its defaults.
 */
export interface PrintPreferences {
  readonly format?: PrintFormat
  readonly language?: Locale
  readonly ink?: PrintInk
}

const keyFor = (slug: string): string => `eventslide.print.${slug}`

const isFormat = (value: unknown): value is PrintFormat =>
  PRINT_FORMATS.some((format) => format === value)

const isInk = (value: unknown): value is PrintInk => PRINT_INKS.some((ink) => ink === value)

const isLocale = (value: unknown): value is Locale =>
  SUPPORTED_LOCALES.some((locale) => locale === value)

export const readPrintPreferences = (slug: string): PrintPreferences => {
  try {
    const raw = window.localStorage.getItem(keyFor(slug))
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const { format, language, ink } = parsed as Record<string, unknown>
    return {
      ...(isFormat(format) ? { format } : {}),
      ...(isLocale(language) ? { language } : {}),
      ...(isInk(ink) ? { ink } : {}),
    }
  } catch {
    return {}
  }
}

export const writePrintPreferences = (slug: string, preferences: PrintPreferences): void => {
  try {
    window.localStorage.setItem(keyFor(slug), JSON.stringify(preferences))
  } catch {
    // Storage is a convenience; the page works without it.
  }
}
