import { describe, expect, it } from 'vitest'
import { EmailAddress } from '../users/emailAddress'
import { checkOutgoingMail } from './outgoingMail'
import { hostAnnouncementMail } from './hostAnnouncementMail'

const address = (raw: string): EmailAddress => {
  const made = EmailAddress.create(raw)
  if (!made.ok) throw new Error('fixture')
  return made.value
}
const TO = address('hote@example.test')
const CONTACT = address('contact@operateur.example')

describe('hostAnnouncementMail (A8)', () => {
  it('is the operator’s subject and text untouched, then the product’s name, with no link of our own', () => {
    const mail = hostAnnouncementMail({
      to: TO,
      announcement: { subject: 'Wichtig', text: 'Zeile eins\nZeile zwei', link: null },
      replyTo: null,
    })

    expect(mail.subject).toBe('Wichtig')
    expect(mail.text).toBe('Zeile eins\nZeile zwei\n\nEventSlide\n')
    expect(mail.replyTo).toBeUndefined()
    expect(checkOutgoingMail(mail).ok).toBe(true)
  })

  it('carries the one link the operator gave, on a line of its own, and the operator’s address to answer', () => {
    const mail = hostAnnouncementMail({
      to: TO,
      announcement: { subject: 's', text: 't', link: 'https://eventslide.fr/legal/cgu' },
      replyTo: CONTACT,
    })

    expect(mail.text.split('\n')).toContain('https://eventslide.fr/legal/cgu')
    expect(mail.text.match(/https?:\/\//g)).toHaveLength(1)
    expect(mail.replyTo).toEqual(CONTACT)
  })
})
