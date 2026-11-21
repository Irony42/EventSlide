import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { QRCodeSVG } from 'qrcode.react'
import { INVITATION_DESIGNS, invitationQrShareOf } from '../../../lib/print/printDesigns'
import { PRINT_FORMAT_SPECS, isQrTooSmall, moduleMm, qrMmOf, totalModulesOf } from './printKit'

/** The link of a hosted invitation is about 45 characters; a longer domain makes 70. */
const LINKS = [
  'https://app.eventslide.fr/i/7QX0M4TZ2KD9WB3H',
  'https://invitations.maison-des-tilleuls.example.org/i/7QX0M4TZ2KD9WB3H',
]

const modulesOf = (url: string): number => {
  const { container, unmount } = render(<QRCodeSVG value={url} level="M" marginSize={4} />)
  const total = totalModulesOf(container.querySelector('svg'))
  unmount()
  if (total === null) throw new Error('no QR drawn')
  return total
}

describe('the QR of an invitation card', () => {
  it.each(INVITATION_DESIGNS)('%s draws it at 30 mm or more on an A6 card', (design) => {
    expect(qrMmOf('card', invitationQrShareOf(design))).toBeGreaterThanOrEqual(30)
  })

  it.each(INVITATION_DESIGNS)(
    '%s keeps a printed module of 0.6 mm or more for a link of 45 to 70 characters',
    (design) => {
      for (const url of LINKS) {
        const modules = modulesOf(url)
        expect(isQrTooSmall('card', invitationQrShareOf(design), modules), `${design} ${url}`).toBe(
          false,
        )
        expect(
          moduleMm(qrMmOf('card', invitationQrShareOf(design)), modules),
        ).toBeGreaterThanOrEqual(0.6)
      }
    },
  )

  it('is bigger on the A5 card, in proportion', () => {
    expect(PRINT_FORMAT_SPECS.a5.cardMm).toBeGreaterThan(PRINT_FORMAT_SPECS.card.cardMm)
    expect(qrMmOf('a5', invitationQrShareOf('guirlande'))).toBeGreaterThan(
      qrMmOf('card', invitationQrShareOf('guirlande')),
    )
  })
})
