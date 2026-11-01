import { describe, expect, it } from 'vitest'
import { ANONYMOUS_SIGNATURE, renderGuestbookText } from './guestbookExport'

describe('renderGuestbookText', () => {
  const at = new Date('2026-06-20T21:05:59.000Z')

  it('writes the event name, then one block per message, oldest first as given', () => {
    const text = renderGuestbookText('Camille & Sacha', [
      { author: 'Léa', at, text: 'Merci\npour tout' },
      { author: 'Sam', at: new Date('2026-06-21T08:00:00.000Z'), text: 'Bravo' },
    ])

    expect(text).toBe(
      'Camille & Sacha\n\nLéa, 2026-06-20 21:05 UTC\nMerci\npour tout\n\nSam, 2026-06-21 08:00 UTC\nBravo\n',
    )
  })

  it('signs a message whose author has no name with the anonymous signature', () => {
    expect(renderGuestbookText('Noces', [{ author: null, at, text: 'Joli' }])).toContain(
      `${ANONYMOUS_SIGNATURE}, 2026-06-20 21:05 UTC\nJoli`,
    )
  })

  it('writes only the header for an empty book', () => {
    expect(renderGuestbookText('Noces', [])).toBe('Noces\n\n')
  })
})
