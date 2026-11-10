import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fr } from '../../../lib/i18n/fr'
import { qrPatternOf } from '../../../testing/qrPattern'
import type { JoinSlot } from '../joinSlot'
import { JoinInvite } from './JoinInvite'
import { JoinQr } from './JoinQr'

const JOIN = { code: 'H7K2QM', url: 'https://photos.example.com/join/H7K2QM' }

const patternFor = (url: string): string => {
  const { container, unmount } = render(<JoinQr url={url} />)
  const drawn = qrPatternOf(container)
  unmount()
  return drawn
}

describe('JoinInvite', () => {
  it.each<[JoinSlot, string]>([
    ['corner', fr.wall.sendPrompt],
    ['band', fr.wall.sendPrompt],
    ['tile', fr.wall.invitePrompt.tile],
    ['cell', fr.wall.invitePrompt.cell],
    ['print', fr.wall.invitePrompt.print],
    ['tag', fr.wall.invitePrompt.tag],
    ['seam', fr.wall.invitePrompt.seam],
  ])('titles the %s with what to do there', (slot, prompt) => {
    render(<JoinInvite join={JOIN} slot={slot} onDismiss={vi.fn()} />)

    expect(screen.getByRole('heading', { name: prompt })).toBeVisible()
  })

  it.each<JoinSlot>(['corner', 'tile', 'cell', 'print', 'tag', 'band', 'seam'])(
    'draws the same code, the server’s link, whatever the dress (%s)',
    (slot) => {
      const { container } = render(<JoinInvite join={JOIN} slot={slot} onDismiss={vi.fn()} />)

      expect(qrPatternOf(container)).toBe(patternFor(JOIN.url))
      expect(screen.getByText(JOIN.code)).toBeVisible()
      expect(screen.getByText(fr.wall.typeCodeAt(JOIN.code, 'photos.example.com'))).toBeVisible()
    },
  )

  it('marks its close button for the wall to hide with the idle cursor', () => {
    render(<JoinInvite join={JOIN} slot="tile" onDismiss={vi.fn()} />)

    expect(screen.getByRole('button', { name: fr.wall.dismissJoinCard })).toHaveAttribute(
      'data-join-dismiss',
    )
  })
})
