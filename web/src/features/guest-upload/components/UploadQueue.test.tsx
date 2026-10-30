import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../testing/renderWithProviders'
import { fr } from '../../../lib/i18n/fr'
import { summarizeBatch } from '../hooks/queueBatch'
import { UploadQueue } from './UploadQueue'
import type { UploadItem, UploadItemState } from '../hooks/useUploadQueue'

/**
 * The queue's rows and the one line they fold into once the whole batch has arrived. Whether the
 * batch is finished is `summarizeBatch`'s answer, given to the component; what is tested here is
 * what the guest sees and can press because of it.
 */

const row = (
  n: number,
  state: UploadItemState,
  photoId: string | null = `photo-${n}`,
): UploadItem => ({
  id: `upload-${n}`,
  file: new File([], `p${n}.jpg`),
  previewUrl: `blob:p${n}`,
  state,
  progress: state === 'uploading' ? 40 : 0,
  error: state === 'failed' ? 'Connexion perdue.' : null,
  photoId,
  retryable: state === 'failed',
  outboxId: null,
})

interface Handlers {
  readonly onRetry?: () => void
  readonly onRemove?: () => void
  readonly onDismiss?: () => void
  readonly onViewMine?: (() => void) | undefined
}

const element = (items: readonly UploadItem[], handlers: Handlers = {}) => (
  <UploadQueue
    items={items}
    batch={summarizeBatch(items)}
    onRetry={handlers.onRetry ?? vi.fn()}
    onRemove={handlers.onRemove ?? vi.fn()}
    onDismiss={handlers.onDismiss ?? vi.fn()}
    onViewMine={'onViewMine' in handlers ? handlers.onViewMine : vi.fn()}
  />
)

const render = (items: readonly UploadItem[], handlers: Handlers = {}) =>
  renderWithProviders(element(items, handlers))

const arrived = (count: number, state: UploadItemState = 'done'): readonly UploadItem[] =>
  Array.from({ length: count }, (_unused, index) => row(index, state))

const detailsButton = () => screen.getByRole('button', { name: fr.upload.queueDetails })

describe('UploadQueue: once the whole batch has arrived', () => {
  it('folds the rows into one line that counts the photos', () => {
    render(arrived(7))

    expect(screen.getByText(fr.upload.queueDone(7, 0))).toBeVisible()
    expect(screen.getByText(fr.upload.queueDone(7, 0))).toHaveTextContent('7 photos envoyées')
  })

  it('says how many of them the event already held', () => {
    render([...arrived(4), row(4, 'duplicate'), row(5, 'duplicate'), row(6, 'duplicate')])

    expect(screen.getByText(fr.upload.queueDone(7, 3))).toHaveTextContent(
      '7 photos envoyées (3 étaient déjà là)',
    )
  })

  it('puts a single duplicate in the singular, and a batch of nothing else in its own words', () => {
    const { unmount } = render([row(0, 'done'), row(1, 'duplicate')])
    expect(screen.getByText(/1 était déjà là/)).toBeVisible()
    unmount()

    render([row(0, 'duplicate'), row(1, 'duplicate')])
    expect(screen.getByText('Ces 2 photos étaient déjà là')).toBeVisible()
  })

  it('hides every row, and keeps each one in the page with its state', () => {
    render([row(0, 'done'), row(1, 'duplicate')])

    // The contract the end-to-end suite reads is intact: present, with its state.
    expect(screen.getByTestId('upload-item-0')).toHaveAttribute('data-state', 'done')
    expect(screen.getByTestId('upload-item-1')).toHaveAttribute('data-state', 'duplicate')
    // And out of the accessibility tree, and off the screen.
    expect(screen.getByTestId('upload-item-0')).not.toBeVisible()
    expect(screen.queryByRole('img', { name: fr.upload.itemAlt(1) })).toBeNull()
    expect(screen.queryByText(fr.upload.itemDuplicate)).not.toBeVisible()
  })

  it('offers the way to the guest’s list, the details and a way to dismiss the line', () => {
    render(arrived(2))

    expect(screen.getByRole('button', { name: fr.upload.queueViewMine })).toBeVisible()
    expect(detailsButton()).toBeVisible()
    expect(screen.getByRole('button', { name: fr.upload.queueDismiss })).toBeVisible()
  })

  it('does not offer the way to the list when there is no list to go to', () => {
    render(arrived(2), { onViewMine: undefined })

    expect(screen.queryByRole('button', { name: fr.upload.queueViewMine })).toBeNull()
    expect(detailsButton()).toBeVisible()
  })

  it('calls the way to the list, and nothing else, when that button is pressed', async () => {
    const onViewMine = vi.fn()
    const onDismiss = vi.fn()
    render(arrived(2), { onViewMine, onDismiss })

    await userEvent.click(screen.getByRole('button', { name: fr.upload.queueViewMine }))

    expect(onViewMine).toHaveBeenCalledTimes(1)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('dismisses the line with its ×', async () => {
    const onDismiss = vi.fn()
    render(arrived(2), { onDismiss })

    await userEvent.click(screen.getByRole('button', { name: fr.upload.queueDismiss }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  describe('"Détails"', () => {
    it('is a disclosure that points at the rows, and starts closed', () => {
      render(arrived(2))

      expect(detailsButton()).toHaveAttribute('aria-expanded', 'false')
      const rows = document.getElementById(detailsButton().getAttribute('aria-controls') ?? '')
      expect(rows).not.toBeNull()
      expect(rows).toContainElement(screen.getByTestId('upload-item-0'))
      expect(rows).not.toBeVisible()
    })

    it('brings every row back, with the word of its own state, and folds them again', async () => {
      render([row(0, 'done'), row(1, 'duplicate')])

      await userEvent.click(detailsButton())

      expect(detailsButton()).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByTestId('upload-item-0')).toBeVisible()
      expect(screen.getByText(fr.upload.itemDuplicate)).toBeVisible()
      expect(screen.getByRole('img', { name: fr.upload.itemAlt(2) })).toBeVisible()

      await userEvent.click(detailsButton())

      expect(detailsButton()).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByTestId('upload-item-0')).not.toBeVisible()
    })

    it('can still take one row out, from the rows it brought back', async () => {
      const onRemove = vi.fn()
      render(arrived(2), { onRemove })

      await userEvent.click(detailsButton())
      await userEvent.click(screen.getByRole('button', { name: fr.upload.removeItem(2) }))

      expect(onRemove).toHaveBeenCalledWith('upload-1')
    })
  })
})

describe('UploadQueue: while the batch is not finished', () => {
  it.each(['pending', 'preparing', 'uploading', 'queued'] as const)(
    'shows every row, and none of the summary line, while one photo is %s',
    (state) => {
      render([row(0, 'done'), row(1, state)])

      expect(screen.getByTestId('upload-item-0')).toBeVisible()
      expect(screen.getByTestId('upload-item-1')).toBeVisible()
      expect(screen.queryByRole('button', { name: fr.upload.queueDetails })).toBeNull()
      expect(screen.queryByRole('button', { name: fr.upload.queueViewMine })).toBeNull()
      expect(screen.getByText(fr.upload.queueSummary(1, 2))).toBeVisible()
    },
  )

  it('keeps every row open when one failed, with its retry and its ×, and says so', async () => {
    const onRetry = vi.fn()
    render([row(0, 'done'), row(1, 'failed'), row(2, 'duplicate')], { onRetry })

    expect(screen.getByTestId('upload-item-0')).toBeVisible()
    expect(screen.getByTestId('upload-item-1')).toBeVisible()
    expect(screen.getByText(fr.upload.queueFailed(1), { exact: false })).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.upload.queueDetails })).toBeNull()
    expect(screen.getByRole('button', { name: fr.upload.removeItem(2) })).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: fr.upload.retryItem(2) }))
    expect(onRetry).toHaveBeenCalledWith('upload-1')
  })

  it('says the photos are ready, and that nothing has left the phone, before "Envoyer" is pressed', () => {
    // "0 envoyée sur 3" read as a send that had stalled, and the guest put the phone away (INV-7).
    render([row(0, 'pending'), row(1, 'pending'), row(2, 'pending')])

    expect(screen.getByText(fr.upload.queueReady(3))).toBeVisible()
    expect(screen.queryByText(fr.upload.queueSummary(0, 3))).toBeNull()
  })

  it('counts what arrived once the send has begun, even while some photos still wait their turn', () => {
    render([row(0, 'done'), row(1, 'uploading'), row(2, 'pending')])

    expect(screen.getByText(fr.upload.queueSummary(1, 3))).toBeVisible()
    expect(screen.queryByText(fr.upload.queueReady(3))).toBeNull()
  })

  it('keeps the word "attente" for the host: a chosen photo is Prête, a waiting one goes when the network is back', () => {
    render([row(0, 'pending'), row(1, 'queued')])

    const pending = within(screen.getByTestId('upload-item-0'))
    const queued = within(screen.getByTestId('upload-item-1'))
    expect(pending.getByText(fr.upload.itemPending)).toBeVisible()
    expect(queued.getByText(fr.upload.itemQueued)).toBeVisible()
    // Three states had one word ("En attente"); the host's validation is the only one left with it.
    expect(fr.upload.itemPending).not.toMatch(/attente/i)
    expect(fr.upload.itemQueued).not.toMatch(/attente/i)
    expect(fr.upload.statusPending).toMatch(/attente/i)
  })

  it('says there is nothing selected, with no controls, when the queue is empty', () => {
    render([])

    expect(screen.getByText(fr.upload.queueEmpty)).toBeVisible()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('UploadQueue: when the batch settles', () => {
  it('folds the rows by itself once the last photo arrives, and was open until then', () => {
    const { rerender } = render([row(0, 'done'), row(1, 'uploading')])
    expect(screen.getByTestId('upload-item-1')).toBeVisible()

    rerender(element([row(0, 'done'), row(1, 'done')]))

    expect(screen.getByTestId('upload-item-1')).not.toBeVisible()
    expect(screen.getByText(fr.upload.queueDone(2, 0))).toBeVisible()
  })

  it('folds a batch that a retry has just made whole', () => {
    const { rerender } = render([row(0, 'done'), row(1, 'failed')])
    expect(screen.getByTestId('upload-item-1')).toBeVisible()

    rerender(element([row(0, 'done'), row(1, 'done')]))

    expect(screen.getByTestId('upload-item-1')).not.toBeVisible()
  })

  it('does not move focus when it folds', async () => {
    const outside = document.createElement('button')
    document.body.append(outside)
    const { rerender } = render([row(0, 'done'), row(1, 'uploading')])
    outside.focus()

    rerender(element([row(0, 'done'), row(1, 'done')]))

    expect(outside).toHaveFocus()
    outside.remove()
  })

  it('shows the rows again for a new batch, and folds that one closed even if "Détails" was open', async () => {
    const { rerender } = render(arrived(2))
    await userEvent.click(detailsButton())
    expect(screen.getByTestId('upload-item-0')).toBeVisible()

    // New photos arrive: the arrived rows leave and a pending one takes their place.
    rerender(element([row(9, 'pending', null)]))
    expect(screen.getByTestId('upload-item-0')).toBeVisible()
    expect(screen.queryByRole('button', { name: fr.upload.queueDetails })).toBeNull()

    // It is sent and settles: folded, not inheriting the last batch's open disclosure.
    rerender(element([row(9, 'done')]))
    expect(screen.getByTestId('upload-item-0')).not.toBeVisible()
    expect(detailsButton()).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('UploadQueue: what a screen reader hears', () => {
  // The queue's own section: the app's toast stack carries a live region of its own.
  const liveRegions = () => [
    ...screen.getByRole('region', { name: fr.upload.queueLabel }).querySelectorAll('[aria-live]'),
  ]

  it('has one live region, which is the summary line and holds no button and no row', () => {
    render(arrived(3))

    const [region, ...others] = liveRegions()
    expect(others).toEqual([])
    expect(region).toHaveTextContent(fr.upload.queueDone(3, 0))
    expect(within(region as HTMLElement).queryByRole('button')).toBeNull()
    expect(region).not.toContainElement(screen.getByTestId('upload-item-0'))
  })

  it('says the same words whether the rows are folded or open, so opening them announces nothing', async () => {
    render(arrived(3))
    const region = liveRegions()[0] as HTMLElement
    const folded = region.textContent

    await userEvent.click(detailsButton())

    expect(liveRegions()[0]).toBe(region)
    expect(region.textContent).toBe(folded)
  })

  it('is one region before the batch finishes as well, and keeps it when it does', () => {
    const { rerender } = render([row(0, 'done'), row(1, 'uploading')])
    const before = liveRegions()
    expect(before).toHaveLength(1)

    rerender(element(arrived(2)))

    // The same node, so a screen reader hears its text change once rather than a new region appear.
    expect(liveRegions()).toEqual(before)
    expect(before[0]).toHaveTextContent(fr.upload.queueDone(2, 0))
  })
})
