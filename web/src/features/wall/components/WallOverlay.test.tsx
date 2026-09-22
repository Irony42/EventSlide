import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../../lib/i18n/fr'
import { qrPatternOf } from '../../../testing/qrPattern'
import { JoinQr } from './JoinQr'
import { WallOverlay } from './WallOverlay'

const JOIN = { code: 'H7K2QM', url: 'https://photos.example.com/join/H7K2QM' }

const patternFor = (url: string): string => {
  const { container, unmount } = render(<JoinQr url={url} />)
  const drawn = qrPatternOf(container)
  unmount()
  return drawn
}

describe('WallOverlay', () => {
  it('encodes the link the server sent, not the address this screen was opened on', () => {
    // The corner reminder is the QR a *late* guest scans — the one whose printed card is on
    // a table they are not sitting at, and who has nothing but the screen to go on. It has
    // exactly as much claim on being right as the empty wall's invitation, and it had the
    // same bug: built in the browser from `window.location.origin`, so a projector reached
    // on the venue's LAN printed a hostname no phone resolves. Asserted here because the
    // empty state's test cannot see this component at all.
    const { container } = render(<WallOverlay join={JOIN} onDismiss={vi.fn()} />)

    const drawn = qrPatternOf(container)

    expect(drawn).toBe(patternFor(JOIN.url))
    expect(drawn).not.toBe(patternFor(`${window.location.origin}/join/${JOIN.code}`))
  })

  it('prints the code in characters beside it', () => {
    render(<WallOverlay join={JOIN} onDismiss={vi.fn()} />)

    expect(screen.getByText(JOIN.code)).toBeVisible()
    expect(screen.getByRole('heading', { name: fr.wall.joinPrompt })).toBeVisible()
  })

  it('can be put away by the host who walked up to the screen', async () => {
    const onDismiss = vi.fn()
    render(<WallOverlay join={JOIN} onDismiss={onDismiss} />)

    await userEvent.click(screen.getByRole('button', { name: fr.wall.dismissJoinCard }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
