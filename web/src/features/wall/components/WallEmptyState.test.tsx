import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fr } from '../../../lib/i18n/fr'
import { qrPatternOf } from '../../../testing/qrPattern'
import { JoinQr } from './JoinQr'
import { WallEmptyState } from './WallEmptyState'

const JOIN = { code: 'H7K2QM', url: 'https://photos.example.com/join/H7K2QM' }

/** The pattern {@link JoinQr} draws for a link the test names, as the reference to compare. */
const patternFor = (url: string): string => {
  const { container, unmount } = render(<JoinQr url={url} />)
  const drawn = qrPatternOf(container)
  unmount()
  return drawn
}

describe('WallEmptyState', () => {
  it('encodes the link the server sent, not the address this screen was opened on', () => {
    // The wall built this URL itself from `window.location.origin` until now. That is the
    // address the *projector* was pointed at: a mini-PC on the venue's LAN printed a QR
    // for a hostname no guest's phone can resolve, and a box behind a TLS terminator
    // printed plain `http`, on which the `Secure` guest cookie is never sent. Nothing on
    // screen said so — the six characters underneath were right the whole time, which is
    // exactly the shape of §9 trap 1.
    render(<WallEmptyState eventName="Camille & Sacha" join={JOIN} />)

    const drawn = qrPatternOf(screen.getByTestId('wall-join'))

    expect(drawn).toBe(patternFor(JOIN.url))
    expect(drawn).not.toBe(patternFor(`${window.location.origin}/join/${JOIN.code}`))
  })

  it('still invites the room, and prints no QR at all, when the server sends no join link', () => {
    // No QR is a gap a host works around with the printed cards on the tables. A QR
    // pointing somewhere wrong is a guest standing in a corner scanning nothing, and
    // saying nothing to anybody about it. So the block goes rather than falling back.
    render(<WallEmptyState eventName="Camille & Sacha" join={null} />)

    expect(screen.getByText(fr.wall.empty)).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Camille & Sacha' })).toBeVisible()
    expect(screen.queryByTestId('wall-join')).toBeNull()
    expect(screen.queryByTitle(fr.wall.qrTitle)).toBeNull()
  })

  it('reads the code out in characters as well, for the table that cannot scan', () => {
    render(<WallEmptyState eventName="Camille & Sacha" join={JOIN} />)

    expect(screen.getByText(JOIN.code)).toBeVisible()
    expect(screen.getByText(fr.wall.codeLabel)).toBeVisible()
  })
})
