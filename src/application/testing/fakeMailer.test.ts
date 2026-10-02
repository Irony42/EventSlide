import { describe, expect, it } from 'vitest'
import { EmailAddress } from '../../domain/users/emailAddress'
import { mailerContract } from './contracts/mailerContract'
import { FakeMailer } from './fakeMailer'

mailerContract('fake', 'delivers', async () => {
  const mailer = new FakeMailer()
  return {
    mailer,
    delivered: async () => mailer.sent,
    provoke: async (reason) => {
      mailer.failNextWith(reason)
    },
  }
})

const to = (address: string): EmailAddress => {
  const parsed = EmailAddress.create(address)
  if (!parsed.ok) throw new Error(`invalid fixture: ${parsed.error.code}`)
  return parsed.value
}

const aMail = (subject = 'Hello') => ({
  to: to('camille@example.org'),
  subject,
  text: 'Body',
})

describe('FakeMailer', () => {
  it('records the recipient as a plain string, so an assertion needs no unwrapping', async () => {
    const mailer = new FakeMailer()

    await mailer.send(aMail())

    expect(mailer.sent.map((mail) => mail.to)).toEqual(['camille@example.org'])
  })

  it('fails as many sends as it was told to, in order, and then sends again', async () => {
    const mailer = new FakeMailer().failNextWith('transient').failNextWith('rejected')

    const first = await mailer.send(aMail('one'))
    const second = await mailer.send(aMail('two'))
    const third = await mailer.send(aMail('three'))

    expect(!first.ok && first.error.code).toBe('mail.transient')
    expect(!second.ok && second.error.code).toBe('mail.rejected')
    expect(third.ok).toBe(true)
    expect(mailer.sent.map((mail) => mail.subject)).toEqual(['three'])
  })

  it('validates before it fails, so a queued failure is not spent on a message that was never valid', async () => {
    const mailer = new FakeMailer().failNextWith('transient')

    const invalid = await mailer.send(aMail(''))
    const valid = await mailer.send(aMail())

    expect(!invalid.ok && invalid.error.code).toBe('mail.subjectInvalid')
    expect(!valid.ok && valid.error.code).toBe('mail.transient')
  })
})
