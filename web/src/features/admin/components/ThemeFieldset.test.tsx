import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_EVENT_THEME } from '../../../design-system/eventTheme'
import { fr } from '../../../lib/i18n/fr'
import { renderWithProviders } from '../../../testing/renderWithProviders'
import { ThemeFieldset } from './ThemeFieldset'
import type { EventThemeDto } from '../../../lib/api/dto'

/**
 * What a host actually picks.
 *
 * The property under test is the constraint rather than the mechanics: every choice on
 * this screen is one the server accepts, so a host cannot reach a refusal from here. An
 * arbitrary colour input would make that untrue in one line.
 */

const aTheme = (overrides: Partial<EventThemeDto> = {}): EventThemeDto => ({
  ...DEFAULT_EVENT_THEME,
  ...overrides,
})

const renderFieldset = (theme: EventThemeDto, disabled = false) => {
  const onChange = vi.fn()
  renderWithProviders(<ThemeFieldset theme={theme} disabled={disabled} onChange={onChange} />)
  return onChange
}

describe('ThemeFieldset', () => {
  it('offers a short list of named colours rather than a colour input', () => {
    // The decision this component exists to encode: a host setting up a wedding at 18:00
    // cannot judge contrast, and a picker that lets them try guarantees a support queue.
    renderFieldset(aTheme())

    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(document.querySelector('input[type="color"]')).toBeNull()
  })

  it('names every colour, so the swatch is never the only signal', () => {
    // DESIGN-SYSTEM.md §8: a colourblind host works under stage lighting. The swatch is
    // `aria-hidden` and the radio's accessible name is the word beside it.
    renderFieldset(aTheme())

    expect(screen.getByRole('radio', { name: fr.admin.themeAccentNames.rose })).toBeVisible()
  })

  it('shows which colour the event is on', () => {
    renderFieldset(aTheme({ accentHue: 345 }))

    expect(screen.getByRole('radio', { name: fr.admin.themeAccentNames.rose })).toBeChecked()
  })

  it('shows none of them selected for a hue set outside the console', () => {
    // The API takes any legible angle, so the stored hue need not be one of the four.
    // Claiming the nearest would tell a host they chose something they did not.
    renderFieldset(aTheme({ accentHue: 200 }))

    expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0)
  })

  it('reports a colour as a whole theme, never as a loose hue', async () => {
    // The three choices are one decision, because the legibility rule judges them
    // together and the settings endpoint refuses half of one.
    const onChange = renderFieldset(aTheme({ fonts: 'serif', frame: 'round' }))

    await userEvent.click(screen.getByRole('radio', { name: fr.admin.themeAccentNames.azure }))

    expect(onChange).toHaveBeenCalledWith({
      accentHue: 250,
      fonts: 'serif',
      frame: 'round',
      material: 'glass',
    })
  })

  it('reports a font pairing the same way', async () => {
    const onChange = renderFieldset(aTheme())

    await userEvent.selectOptions(
      screen.getByLabelText(fr.admin.themeFonts, { exact: false }),
      'serif',
    )

    expect(onChange).toHaveBeenCalledWith({
      accentHue: 305,
      fonts: 'serif',
      frame: 'soft',
      material: 'glass',
    })
  })

  it('reports a frame style the same way', async () => {
    const onChange = renderFieldset(aTheme())

    await userEvent.selectOptions(screen.getByLabelText(fr.admin.themeFrame), 'square')

    expect(onChange).toHaveBeenCalledWith({
      accentHue: 305,
      fonts: 'sans',
      frame: 'square',
      material: 'glass',
    })
  })

  it('reports the material the same way', async () => {
    // Roadmap 11.5, and a select rather than a checkbox for the reason the pairing is
    // one: a theme names a face, a corner and a surface, and none of the three is an
    // on-off switch. The whole theme travels, because the server replaces it whole.
    const onChange = renderFieldset(aTheme())

    await userEvent.selectOptions(
      screen.getByLabelText(fr.admin.themeMaterial, { exact: false }),
      'plain',
    )

    expect(onChange).toHaveBeenCalledWith({
      accentHue: 305,
      fonts: 'sans',
      frame: 'soft',
      material: 'plain',
    })
  })

  it('says how little the material changes, because the name promises more', () => {
    // A pane is opaque to 92–95%, so turning the glass off changes the five to eight per
    // cent that showed through it (roadmap 11.4). A host who reads "verre" and expects the
    // room to transform will otherwise think the save failed — and the hint also says the
    // one thing they cannot see from here, which is that the wall is already plain.
    renderFieldset(aTheme())

    expect(screen.getByText(fr.admin.themeMaterialHint)).toBeVisible()
  })

  it('says where the typography is applied, because a host cannot see it from here', () => {
    // The honest scope, on the screen where the choice is made: the pairing is a
    // projector decision, and a host who changed it and then looked at their phone would
    // otherwise think it had not saved.
    renderFieldset(aTheme())

    expect(screen.getByText(fr.admin.themeFontsHint)).toBeVisible()
  })

  it('is inert on an event nobody may edit any more', async () => {
    const onChange = renderFieldset(aTheme(), true)

    expect(screen.getByRole('radio', { name: fr.admin.themeAccentNames.azure })).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: fr.admin.themeAccentNames.azure }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
