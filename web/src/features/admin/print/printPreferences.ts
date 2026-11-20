import { SUPPORTED_LOCALES, type Locale } from '../../../lib/i18n/locale'
import { PRINT_FORMATS, PRINT_INKS, isHexColour, type PrintFormat, type PrintInk } from './printKit'
import {
  PRINT_TEXT_LIMITS,
  isPrintDesign,
  type PrintDesign,
  type PrintTextField,
} from '../../../lib/print/printDesigns'

/**
 * What the host last chose on this device, per event.
 *
 * Never the join code or the link in the value (a stored code would be a secret that outlives its
 * rotation). The texts of the card (spec 28) are the host's own words for this card, kept here
 * rather than on the server: they are printed by whoever stands at this printer, and a moderator on
 * another machine starts from the defaults. An empty title stands for the event's name, read fresh
 * each time, so a renamed event prints its new name. Read and written under `try/catch`: a private
 * window or blocked storage must leave the page working with its defaults.
 */
export interface PrintPreferences {
  readonly format?: PrintFormat
  readonly language?: Locale
  readonly ink?: PrintInk
  /** The event's logo at the centre of the QR; the logo itself is never stored here. */
  readonly logo?: boolean
  readonly design?: PrintDesign
  /** The host's words; an absent field prints the default (the event's name, the usual line). */
  readonly texts?: Partial<Record<PrintTextField, string>>
  /** The three numbered steps, on the designs that have room for them. */
  readonly steps?: boolean
  /** `#rrggbb`; absent prints in the event's own colour. */
  readonly colour?: string
  /** Where the photograph is anchored when it is cropped, in percent of each side. */
  readonly focusX?: number
  readonly focusY?: number
}

const keyFor = (slug: string): string => `eventslide.print.${slug}`

const isFormat = (value: unknown): value is PrintFormat =>
  PRINT_FORMATS.some((format) => format === value)

const isInk = (value: unknown): value is PrintInk => PRINT_INKS.some((ink) => ink === value)

const isLocale = (value: unknown): value is Locale =>
  SUPPORTED_LOCALES.some((locale) => locale === value)

const isPercent = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100

/** Each text kept only when it is a string within its cap; anything else is dropped, not cut. */
const textsOf = (value: unknown): Partial<Record<PrintTextField, string>> | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  const kept: Partial<Record<PrintTextField, string>> = {}
  for (const field of Object.keys(PRINT_TEXT_LIMITS) as PrintTextField[]) {
    const text = raw[field]
    if (typeof text === 'string' && text.length <= PRINT_TEXT_LIMITS[field]) kept[field] = text
  }
  return kept
}

export const readPrintPreferences = (slug: string): PrintPreferences => {
  try {
    const raw = window.localStorage.getItem(keyFor(slug))
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const { format, language, ink, logo, design, texts, steps, colour, focusX, focusY } =
      parsed as Record<string, unknown>
    const keptTexts = textsOf(texts)
    return {
      ...(isFormat(format) ? { format } : {}),
      ...(isLocale(language) ? { language } : {}),
      ...(isInk(ink) ? { ink } : {}),
      ...(typeof logo === 'boolean' ? { logo } : {}),
      ...(isPrintDesign(design) ? { design } : {}),
      ...(keptTexts === undefined ? {} : { texts: keptTexts }),
      ...(typeof steps === 'boolean' ? { steps } : {}),
      ...(isHexColour(colour) ? { colour: colour.toLowerCase() } : {}),
      ...(isPercent(focusX) ? { focusX } : {}),
      ...(isPercent(focusY) ? { focusY } : {}),
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
