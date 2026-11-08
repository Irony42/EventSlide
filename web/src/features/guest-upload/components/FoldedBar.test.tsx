import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../testing/renderWithProviders'
import { fr } from '../../../lib/i18n/fr'
import { FoldedBar, type FoldedBarProps } from './FoldedBar'
import type { UploadItem, UploadItemState } from '../hooks/useUploadQueue'

const row = (n: number, state: UploadItemState = 'pending'): UploadItem => ({
  id: `upload-${n}`,
  file: new File([], `p${n}.jpg`),
  previewUrl: `blob:p${n}`,
  state,
  progress: 0,
  error: null,
  photoId: null,
  retryable: false,
  outboxId: null,
  missionId: null,
})

const bar = (props: Partial<FoldedBarProps> = {}) => {
  const handlers = { onOpen: vi.fn(), onSend: vi.fn() }
  renderWithProviders(
    <FoldedBar
      items={[]}
      sendableCount={0}
      sending={false}
      status=""
      controls="pane"
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

describe('FoldedBar', () => {
  it('offers one big button when nothing is chosen', async () => {
    const { onOpen } = bar()
    const open = screen.getByRole('button', { name: fr.upload.openPane })
    expect(open).toHaveAttribute('aria-expanded', 'false')
    expect(open).toHaveAttribute('aria-controls', 'pane')
    await userEvent.click(open)
    expect(onOpen).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('folded-badge')).toBeNull()
  })

  it('shows the chosen photos, stacked at three, with a badge that counts all of them', async () => {
    const items = [1, 2, 3, 4, 5].map((n) => row(n))
    const { onOpen, onSend } = bar({ items, sendableCount: 5 })

    expect(document.querySelectorAll('img')).toHaveLength(3)
    expect(screen.getByTestId('folded-badge')).toHaveTextContent('5')
    await userEvent.click(screen.getByRole('button', { name: fr.upload.openPaneReady(5) }))
    expect(onOpen).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: fr.upload.sendCount(5) }))
    expect(onSend).toHaveBeenCalledOnce()
  })

  it('says how a send is going in a polite status, in the place of the thumbnails', () => {
    bar({ items: [row(1, 'done')], status: '1 envoyée sur 1' })
    expect(screen.getByRole('status')).toHaveTextContent('1 envoyée sur 1')
  })
})
