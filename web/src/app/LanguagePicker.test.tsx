import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguagePicker } from './LanguagePicker'
import { de } from '../lib/i18n/de'
import { fr } from '../lib/i18n/fr'
import { LOCALE_NAMES, SUPPORTED_LOCALES } from '../lib/i18n/locale'
import { readStoredLocale } from '../lib/i18n/localePreference'
import { renderWithProviders } from '../testing/renderWithProviders'

/**
 * The manual override. Surface: the **guest**, one thumb, forty seconds.
 *
 * Ring 5: a component, a `<select>`, and the provider it reads from. Nothing here
 * crosses HTTP, and the journey it belongs to — a German phone scanning a French
 * wedding's QR code — is asserted once at ring 6.
 */

describe('LanguagePicker', () => {
  it('offers every language the app has a table for', () => {
    renderWithProviders(<LanguagePicker />)

    for (const locale of SUPPORTED_LOCALES) {
      expect(screen.getByRole('option', { name: LOCALE_NAMES[locale] })).toBeInTheDocument()
    }
  })

  it('names each language in itself, so it is readable from any of them', () => {
    // The list a guest scans when the page is in a language they cannot read. "Deutsch",
    // never "Allemand" — and no flags, because a flag is a country and Spanish is not
    // Spain.
    renderWithProviders(<LanguagePicker />, { locale: 'de' })

    expect(screen.getByRole('option', { name: 'Français' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Español' })).toBeInTheDocument()
  })

  it('shows the language the page is currently in', () => {
    renderWithProviders(<LanguagePicker />, { locale: 'it' })

    expect(screen.getByRole('combobox')).toHaveValue('it')
  })

  it('carries its own name in the language of the page', () => {
    // What a screen-reader user hears. Hearing "Langue" on a page rendered in German is
    // the same failure the picker exists to fix.
    const { unmount } = renderWithProviders(<LanguagePicker />)
    expect(screen.getByRole('combobox', { name: fr.app.language })).toBeInTheDocument()
    unmount()

    renderWithProviders(<LanguagePicker />, { locale: 'de' })
    expect(screen.getByRole('combobox', { name: de.app.language })).toBeInTheDocument()
  })

  it('persists the choice as soon as it is made, with nothing else to press', () => {
    // No Save button. A guest who has found the language list has already said what
    // they want, and a second tap in a dark room is another chance to give up.
    renderWithProviders(<LanguagePicker />)

    return userEvent.selectOptions(screen.getByRole('combobox'), 'es').then(() => {
      expect(readStoredLocale()).toBe('es')
    })
  })

  it('changes the page it is on', async () => {
    renderWithProviders(<LanguagePicker />)

    await userEvent.selectOptions(screen.getByRole('combobox'), 'de')

    expect(screen.getByRole('combobox', { name: de.app.language })).toBeInTheDocument()
  })
})
