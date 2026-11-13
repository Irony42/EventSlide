import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { fr } from '../../lib/i18n/fr'
import { renderWithProviders } from '../../testing/renderWithProviders'
import { GuidedTour, type TourStep } from './GuidedTour'

const STEPS: readonly TourStep[] = [
  { id: 'welcome', targets: [], title: 'Bienvenue', body: 'Un tour ?' },
  { id: 'card', targets: ['card'], title: 'La carte', body: 'Ce qui compte.' },
  { id: 'gone', targets: ['nowhere'], title: 'Absente', body: 'Pas sur cette page.' },
  { id: 'tiles', targets: ['a', 'b'], title: 'Les tuiles', body: 'Deux gestes.' },
]

function Page({
  steps = STEPS,
  onFinish = () => undefined,
  onDismiss = () => undefined,
}: {
  readonly steps?: readonly TourStep[]
  readonly onFinish?: () => void
  readonly onDismiss?: () => void
}) {
  const [open, setOpen] = useState(false)
  const back = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={back} type="button" onClick={() => setOpen(true)}>
        Visite
      </button>
      <section data-tour="card">Carte</section>
      <a data-tour="a" href="#a">
        A
      </a>
      <a data-tour="b" href="#b">
        B
      </a>
      <GuidedTour
        open={open}
        steps={steps}
        onFinish={() => {
          onFinish()
          setOpen(false)
        }}
        onDismiss={() => {
          onDismiss()
          setOpen(false)
        }}
        returnFocusRef={back}
      />
    </>
  )
}

/** The tour shows a step once it has been measured, on the next frame. */
const shown = (name: string) => screen.findByRole('dialog', { name })

const press = async (name: string) => {
  await userEvent.click(await screen.findByRole('button', { name }))
}

const start = async () => {
  await press('Visite')
  return shown('Bienvenue')
}

describe('GuidedTour', () => {
  it('opens on a welcome that offers the tour or later, with no step count', async () => {
    renderWithProviders(<Page />)

    const tour = await start()

    expect(tour).toHaveAccessibleDescription('Un tour ?')
    expect(within(tour).getByRole('button', { name: fr.ui.tourLater })).toBeVisible()
    await waitFor(() =>
      expect(within(tour).getByRole('button', { name: fr.ui.tourStart })).toHaveFocus(),
    )
    expect(within(tour).queryByText(/Étape/)).toBeNull()
  })

  it('counts the steps that light something, and leaves out one whose region is not on the page', async () => {
    renderWithProviders(<Page />)
    await start()

    await press(fr.ui.tourStart)
    await shown('La carte')
    expect(screen.getByText(fr.ui.tourStep(1, 2))).toBeVisible()

    await press(fr.ui.tourNext)
    // "Absente" names no element on this page, so the next stop is the tiles.
    await shown('Les tuiles')
    expect(screen.getByText(fr.ui.tourStep(2, 2))).toBeVisible()
  })

  it('goes back a step', async () => {
    renderWithProviders(<Page />)
    await start()
    await press(fr.ui.tourStart)
    await shown('La carte')

    await press(fr.ui.tourPrevious)

    expect(await shown('Bienvenue')).toBeVisible()
  })

  it('finishes on the last step, with no way to skip what is already over', async () => {
    const onFinish = vi.fn()
    const onDismiss = vi.fn()
    renderWithProviders(<Page onFinish={onFinish} onDismiss={onDismiss} />)
    await start()
    await press(fr.ui.tourStart)
    await shown('La carte')
    await press(fr.ui.tourNext)
    await shown('Les tuiles')

    expect(screen.queryByRole('button', { name: fr.ui.tourSkip })).toBeNull()
    await press(fr.ui.tourFinish)

    expect(onFinish).toHaveBeenCalledOnce()
    expect(onDismiss).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is left by "Plus tard", by "Passer" and by Escape, and gives focus back', async () => {
    const onDismiss = vi.fn()
    renderWithProviders(<Page onDismiss={onDismiss} />)

    await start()
    await press(fr.ui.tourLater)
    expect(screen.getByRole('button', { name: 'Visite' })).toHaveFocus()

    await start()
    await press(fr.ui.tourStart)
    await shown('La carte')
    await press(fr.ui.tourSkip)

    await start()
    await userEvent.keyboard('{Escape}')

    expect(onDismiss).toHaveBeenCalledTimes(3)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('moves with the arrow keys', async () => {
    renderWithProviders(<Page />)
    await start()

    await userEvent.keyboard('{ArrowRight}')
    expect(await shown('La carte')).toBeVisible()

    await userEvent.keyboard('{ArrowLeft}')
    expect(await shown('Bienvenue')).toBeVisible()
  })

  it('keeps Tab inside the bubble', async () => {
    renderWithProviders(<Page />)
    await start()
    await press(fr.ui.tourStart)
    const tour = await shown('La carte')

    for (let pressed = 0; pressed < 5; pressed += 1) {
      await userEvent.tab()
      expect(tour).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it('lays the tour over the whole page, outside the page’s own tree', async () => {
    renderWithProviders(
      <>
        <button type="button" data-tour="card">
          Ouvrir aux invités
        </button>
        <GuidedTour open steps={STEPS} onFinish={() => undefined} onDismiss={() => undefined} />
      </>,
    )

    await shown('Bienvenue')

    // A child of the document's body, so no transform or overflow of the page clips or moves it,
    // and its layer (`position: fixed; inset: 0`) is what a click on the page lands on.
    expect(screen.getByTestId('guided-tour').parentElement).toBe(document.body)
  })
})
