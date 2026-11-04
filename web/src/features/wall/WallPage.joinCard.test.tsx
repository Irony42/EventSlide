import { render, screen } from '@testing-library/react'
import { QRCodeSVG } from 'qrcode.react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { fr } from '../../lib/i18n/fr'
import type { WallResponse } from '../../lib/api/dto'
import {
  aWallItem,
  aWallMission,
  aWallResponse,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import { qrPatternOf } from '../../testing/qrPattern'
import { WallPage } from './WallPage'

/**
 * The invitation card's three host settings on the wall (spec 14): shown or not, how big, which
 * corner. The geometry itself is CSS (`WallPage.module.css`); what is pinned here is the decision
 * that drives it and the structure that keeps two corner occupants from ever overlapping.
 */
const ROUTE = '/e/camille-et-sacha/display'
const PATH = '/e/:slug/display'
type Card = NonNullable<WallResponse['joinCard']>

const wallWith = (card: Partial<Card>, overrides: Partial<WallResponse> = {}): WallResponse =>
  aWallResponse({
    items: [aWallItem()],
    joinCard: { visible: true, scale: 1, placement: 'bottom-end', ...card },
    ...overrides,
  })

const show = async (wall: WallResponse): Promise<HTMLElement> => {
  const api = fakeApi({ wall: vi.fn(async () => wall) })
  renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })
  await screen.findByTestId('wall-slide')
  const wallElement = document.querySelector('[data-wall-layout]')
  if (!(wallElement instanceof HTMLElement)) throw new Error('no wall')
  return wallElement
}

const theCard = (): HTMLElement => {
  const card = screen.getByText('H7K2QM').closest('section, div[class*="overlay"], article')
  if (!(card instanceof HTMLElement)) throw new Error('no card')
  return card
}

const theMissions = (): HTMLElement | null =>
  screen.getByRole('heading', { name: fr.wall.missionsTitle }).closest('[class*="panel"]')

const theNotices = (): HTMLElement => {
  const region = document.querySelector(
    '[aria-live="polite"]:not([data-testid="new-photo-signal-region"])',
  )
  if (!(region instanceof HTMLElement)) throw new Error('no notices region')
  return region
}

describe('the invitation card settings on the wall (spec 14)', () => {
  it('is the card it always was when nothing is chosen, and when the server sends nothing', async () => {
    const wall = await show(wallWith({}))

    expect(wall).toHaveAttribute('data-wall-chrome', 'corner')
    expect(wall).not.toHaveAttribute('data-wall-join-corner')
    expect(wall.style.getPropertyValue('--wall-join-scale')).toBe('')
    expect(theCard()).not.toHaveAttribute('data-placement')
  })

  it('takes the defaults from an older server that sends no joinCard', async () => {
    const { joinCard: _omitted, ...older } = wallWith({})
    const wall = await show(older)

    expect(screen.getByText('H7K2QM')).toBeVisible()
    expect(wall).toHaveAttribute('data-wall-chrome', 'corner')
    expect(wall).not.toHaveAttribute('data-wall-join-corner')
    expect(theCard().parentElement).toBe(wall)
  })

  it('draws no card on a populated wall when the host switched it off, and Q has nothing to flip', async () => {
    const wall = await show(wallWith({ visible: false }))

    expect(screen.queryByText('H7K2QM')).not.toBeInTheDocument()
    expect(wall).not.toHaveAttribute('data-wall-chrome')

    await userEvent.keyboard('q')
    await userEvent.keyboard('q')
    expect(screen.queryByText('H7K2QM')).not.toBeInTheDocument()
  })

  it('keeps the large invitation of the empty wall whatever the switch says', async () => {
    const api = fakeApi({
      wall: vi.fn(async () => wallWith({ visible: false }, { items: [] })),
    })
    renderWithProviders(<WallPage />, { api, route: ROUTE, path: PATH })

    expect(await screen.findByTitle(fr.wall.qrTitle)).toBeInTheDocument()
    expect(screen.getByText('H7K2QM')).toBeVisible()
  })

  it('draws neither card nor code once the evening is closed, whatever the switch says', async () => {
    await show(wallWith({ visible: true }, { acceptsGuests: false }))

    expect(screen.queryByText('H7K2QM')).not.toBeInTheDocument()
  })

  it.each([0.8, 1.15, 1.5])(
    'spreads the scale %s as the variable the card is sized from',
    async (scale) => {
      const wall = await show(wallWith({ scale }))

      // The fixture's link is short, so the floor (0.8) never lifts the host's choice here.
      expect(Number(wall.style.getPropertyValue('--wall-join-scale'))).toBe(scale === 1 ? 0 : scale)
    },
  )

  it('lifts a small scale to the readability floor of a long link, and only then', async () => {
    const longUrl = `https://app.eventslide.fr/join/${'x'.repeat(70)}`
    const wall = await show(wallWith({ scale: 0.8 }, { joinUrl: longUrl }))

    expect(Number(wall.style.getPropertyValue('--wall-join-scale') || '1')).toBe(1)
  })

  it.each(['bottom-start', 'top-start', 'top-end'] as const)(
    'names the corner %s so the reservation follows its side',
    async (placement) => {
      const wall = await show(wallWith({ placement }))

      expect(wall).toHaveAttribute('data-wall-join-corner', placement)
      expect(theCard()).toHaveAttribute('data-placement', placement)
    },
  )

  it('encodes the server link, level M, with a quiet zone of 4, whatever the size or the corner', async () => {
    const url = aWallResponse().joinUrl as string
    const reference = (value: string) => {
      const { container, unmount } = render(<QRCodeSVG value={value} level="M" marginSize={4} />)
      const pattern = qrPatternOf(container)
      const viewBox = container.querySelector('svg')?.getAttribute('viewBox')
      unmount()
      return { pattern, viewBox }
    }
    const wanted = reference(url)

    for (const card of [
      { scale: 1.5, placement: 'top-start' },
      { scale: 0.8, placement: 'bottom-start' },
    ] as const) {
      const { unmount } = renderWithProviders(<WallPage />, {
        api: fakeApi({ wall: vi.fn(async () => wallWith(card)) }),
        route: ROUTE,
        path: PATH,
      })
      await screen.findByTestId('wall-slide')
      const qr = screen.getByTitle(fr.wall.qrTitle).closest('svg') as SVGElement

      expect(qrPatternOf(qr.parentElement as HTMLElement)).toBe(wanted.pattern)
      expect(qr.getAttribute('viewBox')).toBe(wanted.viewBox)
      expect(wanted.pattern).not.toBe(reference(window.location.origin + '/join/H7K2QM').pattern)
      unmount()
    }
  })

  describe('the top corners are columns, the card first (rule 8)', () => {
    it('stacks the missions under a top-start card, in the same column', async () => {
      await show(wallWith({ placement: 'top-start' }, { missions: [aWallMission()] }))

      const column = theCard().parentElement
      const missions = theMissions()

      expect(missions?.parentElement).toBe(column)
      expect(column?.firstElementChild).toBe(theCard())
    })

    it('stacks the notices under a top-end card, in the same column', async () => {
      await show(wallWith({ placement: 'top-end' }))

      const column = theCard().parentElement

      expect(theNotices().parentElement).toBe(column)
      expect(column?.firstElementChild).toBe(theCard())
    })

    it('leaves the missions and the notices where they always were for the other corners', async () => {
      for (const placement of ['bottom-end', 'bottom-start'] as const) {
        const { unmount } = renderWithProviders(<WallPage />, {
          api: fakeApi({
            wall: vi.fn(async () => wallWith({ placement }, { missions: [aWallMission()] })),
          }),
          route: ROUTE,
          path: PATH,
        })
        await screen.findByTestId('wall-slide')

        // All three are direct children of the wall: no column was made for them.
        const root = document.querySelector('[data-wall-layout]')
        expect(theCard().parentElement).toBe(root)
        expect(theNotices().parentElement).toBe(root)
        expect(theMissions()?.parentElement).toBe(root)
        unmount()
      }
    })

    it('keeps the missions and the notices on a wall with its card switched off, in either corner', async () => {
      await show(
        wallWith({ visible: false, placement: 'top-start' }, { missions: [aWallMission()] }),
      )

      const missions = theMissions()
      expect(missions?.parentElement).toBe(theNotices().parentElement)
    })
  })
})
