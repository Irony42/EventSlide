import { describe, expect, it } from 'vitest'
import { ANONYMOUS_SIGNATURE, clockOf, renderGuestbookText } from './guestbookExport'

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

  describe('a voice message (spec 25)', () => {
    const voice = (file: string | null, caption: string | null = null) => ({
      author: 'Camille',
      at: new Date('2026-11-14T21:42:10.000Z'),
      voice: { durationMs: 23_400, file, caption },
    })

    it('is a bracketed line with its length and its file, then its caption, in the order given', () => {
      const text = renderGuestbookText('Noces', [
        { author: 'Léa', at, text: 'Merci' },
        voice('voice/0007-9f2c1a.m4a', 'Pour vous deux'),
      ])

      expect(text).toBe(
        'Noces\n\nLéa, 2026-06-20 21:05 UTC\nMerci\n\n' +
          'Camille, 2026-11-14 21:42 UTC\n[message vocal, 0:23, voice/0007-9f2c1a.m4a]\nPour vous deux\n',
      )
    })

    it('has no caption line when the guest wrote none', () => {
      expect(renderGuestbookText('Noces', [voice('voice/0001-aaaaaa.m4a')])).toBe(
        'Noces\n\nCamille, 2026-11-14 21:42 UTC\n[message vocal, 0:23, voice/0001-aaaaaa.m4a]\n',
      )
    })

    it('says so when the file is no longer on the disk, instead of naming a file the archive lacks', () => {
      const text = renderGuestbookText('Noces', [voice(null)])

      expect(text).toContain('[message vocal, 0:23, fichier absent]')
      expect(text).not.toContain('.m4a')
    })

    it('ends with how many voices are kept secret and left out, singular and plural', () => {
      const lines = [{ author: 'Léa', at, text: 'Merci' }]

      expect(renderGuestbookText('Noces', lines, 1)).toBe(
        'Noces\n\nLéa, 2026-06-20 21:05 UTC\nMerci\n\n1 message vocal scellé, non inclus\n',
      )
      expect(renderGuestbookText('Noces', lines, 14)).toContain(
        '\n14 messages vocaux scellés, non inclus\n',
      )
      expect(renderGuestbookText('Noces', lines, 0)).not.toContain('scellé')
    })

    it('can carry the secret line alone, for a book whose only messages are secret voices', () => {
      expect(renderGuestbookText('Noces', [], 2)).toBe(
        'Noces\n\n\n2 messages vocaux scellés, non inclus\n',
      )
    })
  })

  describe('clockOf', () => {
    it.each([
      [0, '0:00'],
      [23_400, '0:23'],
      [59_600, '1:00'],
      [65_000, '1:05'],
      [600_000, '10:00'],
      [-5, '0:00'],
    ])('reads %i ms as %s', (ms, expected) => {
      expect(clockOf(ms)).toBe(expected)
    })
  })
})
