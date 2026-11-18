import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { VoiceMessageBody } from './VoiceMessageBody'
import { fr } from '../../../lib/i18n/fr'
import { renderWithProviders } from '../../../testing/renderWithProviders'
import type { GuestbookQueueItemDto } from '../../../lib/api/dto'

const message = {
  id: 'm1',
  voice: { state: 'ready', durationMs: 12_000, bytes: 1000, caption: null },
} as unknown as GuestbookQueueItemDto

const render = (extra: { opensAtMs: number | null; opensWithReveal?: boolean }) =>
  renderWithProviders(
    <VoiceMessageBody slug="s" message={message} author="Camille" sealed {...extra} />,
  )

describe('VoiceMessageBody, kept secret', () => {
  it('says "until the end of the evening" when nothing else lifts the secret', () => {
    render({ opensAtMs: null })
    expect(screen.getByText(fr.guestbookVoiceHost.sealedCard)).toBeVisible()
  })

  it('says it opens with the reveal on a disposable evening', () => {
    render({ opensAtMs: null, opensWithReveal: true })
    expect(screen.getByText(fr.guestbookVoiceHost.sealedCardReveal)).toBeVisible()
    expect(screen.queryByText(fr.guestbookVoiceHost.sealedCard)).toBeNull()
  })

  it('names the hour the host chose, reveal or not', () => {
    render({ opensAtMs: 1_800_000_000_000, opensWithReveal: true })
    expect(screen.queryByText(fr.guestbookVoiceHost.sealedCardReveal)).toBeNull()
  })
})
