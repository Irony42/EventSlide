import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import { PRINT_SWATCHES, PRINT_SWATCH_IDS } from '../../../lib/print/printColours'
import { renderWithProviders } from '../../../testing/renderWithProviders'
import { CardColourPicker, ROW_SIZE } from './CardColourPicker'

const text = fr.guestInvite.host
const EVENT = '#9b6bd1'
const TOTAL = PRINT_SWATCH_IDS.length + 1

function Harness({
  start = null,
  onColour,
}: {
  start?: string | null
  onColour?: (colour: string | null) => void
}) {
  const [chosen, setChosen] = useState<string | null>(start)
  return (
    <CardColourPicker
      chosen={chosen}
      eventColour={EVENT}
      onColour={(colour) => {
        setChosen(colour)
        onColour?.(colour)
      }}
    />
  )
}

const render = (props: Parameters<typeof Harness>[0] = {}) =>
  renderWithProviders(<Harness {...props} />)
const row = () => screen.getByRole('radiogroup', { name: new RegExp(fr.admin.printKitColour) })
const more = () => screen.getByRole('button', { name: text.colourMore })

describe('the colour of the card', () => {
  it('shows one row of six swatches and a button for the rest, not a column of thirteen', () => {
    render()

    expect(within(row()).getAllByRole('radio')).toHaveLength(ROW_SIZE)
    expect(more()).toHaveTextContent(`+${TOTAL - ROW_SIZE}`)
    expect(more()).toHaveAttribute('aria-expanded', 'false')
  })

  it('names the chosen colour, and marks it by a check as well as by its outline', () => {
    render()

    const chosen = within(row()).getByRole('radio', { checked: true })
    expect(chosen).toHaveAccessibleName(fr.admin.printKitColourEvent)
    expect(chosen.querySelector('svg')).not.toBeNull()
    expect(
      within(row()).getAllByRole('radio', { checked: false })[0]?.querySelector('svg'),
    ).toBeNull()
    expect(screen.getByText(fr.admin.printKitColourEvent, { selector: 'span' })).toBeVisible()
  })

  it('chooses a swatch of the row', async () => {
    const onColour = vi.fn()
    render({ onColour })

    await userEvent.click(
      within(row()).getByRole('radio', { name: fr.admin.printSwatchNames.coral }),
    )

    expect(onColour).toHaveBeenCalledWith(PRINT_SWATCHES.coral)
  })

  it('opens every colour and a free picker, and closes on a choice with the focus back on the button', async () => {
    const onColour = vi.fn()
    render({ onColour })

    await userEvent.click(more())
    const all = screen.getByRole('radiogroup', { name: text.colourAll })
    expect(more()).toHaveAttribute('aria-expanded', 'true')
    expect(within(all).getAllByRole('radio')).toHaveLength(TOTAL)
    expect(screen.getByLabelText(fr.admin.printKitColourCustom)).toBeVisible()

    await userEvent.click(
      within(all).getByRole('radio', { name: fr.admin.printSwatchNames.charcoal }),
    )

    expect(onColour).toHaveBeenCalledWith(PRINT_SWATCHES.charcoal)
    expect(screen.queryByRole('radiogroup', { name: text.colourAll })).toBeNull()
    expect(more()).toHaveFocus()
  })

  it('closes on Escape and gives the focus back to the button', async () => {
    render()
    await userEvent.click(more())

    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('radiogroup', { name: text.colourAll })).toBeNull()
    expect(more()).toHaveFocus()
  })

  it('closes when something else is pressed', async () => {
    render()
    await userEvent.click(more())

    await userEvent.click(document.body)

    expect(screen.queryByRole('radiogroup', { name: text.colourAll })).toBeNull()
  })

  it('moves to the next swatch with the arrows, choosing it, and wraps round', async () => {
    const onColour = vi.fn()
    render({ onColour })
    within(row()).getByRole('radio', { checked: true }).focus()

    await userEvent.keyboard('{ArrowRight}')
    expect(onColour).toHaveBeenLastCalledWith(PRINT_SWATCHES.coral)
    await waitFor(() =>
      expect(
        within(row()).getByRole('radio', { name: fr.admin.printSwatchNames.coral }),
      ).toHaveFocus(),
    )

    await userEvent.keyboard('{ArrowLeft}')
    await waitFor(() =>
      expect(
        within(row()).getByRole('radio', { name: fr.admin.printKitColourEvent }),
      ).toHaveFocus(),
    )
    await userEvent.keyboard('{ArrowLeft}')
    expect(onColour).toHaveBeenLastCalledWith(
      PRINT_SWATCHES[PRINT_SWATCH_IDS[ROW_SIZE - 2] ?? 'coral'],
    )
  })

  it('keeps the chosen colour on the row when it lives in the popover, in the last place', () => {
    render({ start: PRINT_SWATCHES.charcoal })

    const swatches = within(row()).getAllByRole('radio')
    expect(swatches).toHaveLength(ROW_SIZE)
    expect(swatches[ROW_SIZE - 1]).toHaveAccessibleName(fr.admin.printSwatchNames.charcoal)
    expect(swatches[ROW_SIZE - 1]).toBeChecked()
  })

  it('shows a colour of the host’s own as "autre couleur" on the row', () => {
    render({ start: '#123456' })

    const last = within(row()).getAllByRole('radio')[ROW_SIZE - 1]
    expect(last).toHaveAccessibleName(fr.admin.printKitColourCustom)
    expect(last).toBeChecked()
  })
})
