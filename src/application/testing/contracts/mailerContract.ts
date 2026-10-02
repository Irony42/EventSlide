import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { Mailer, OutgoingMail } from '../../ports/mailer'
import type { SentMail } from '../fakeMailer'

/**
 * The shared `Mailer` contract (G2-07 / P3-08).
 *
 * Run against three implementations, because each answers a different half of it:
 *
 * - `NullMailer`, for a box with no relay — the self-hoster default. It must say it cannot
 *   deliver, deliver nothing, and fail in the one way a caller turns into "show the link".
 * - `FakeMailer`, the double every use-case test will use. If it accepted something the real
 *   adapter refuses, a ring-2 test would prove a flow that production breaks.
 * - the SMTP adapter, over a real socket to an in-process relay
 *   (`infrastructure/mail/testing/smtpSink.ts`), so what is asserted on is what reached the
 *   other end of an SMTP conversation and not what the adapter says it did.
 *
 * Three of the cases are the expensive traps, written out as assertions:
 *
 * - **a recipient that is really a list.** `EmailAddress` is shallow on purpose and accepts
 *   `a@example.org,b@example.com`; a mail library either splits that into two recipients,
 *   so an invitation meant for one person goes to both, or rewrites it into one quoted
 *   mailbox that nobody chose. Either way the mail goes somewhere the caller did not mean.
 * - **a subject with a line break in it.** That is how a caller-supplied string becomes a
 *   `Bcc:` header.
 * - **a body line that is a single dot.** SMTP ends a message on `<CRLF>.<CRLF>`, so an
 *   adapter that does not stuff the dot truncates the mail — and what follows the dot is
 *   then read by the relay as commands.
 */

export interface MailerSubject {
  readonly mailer: Mailer
  /** What the far side has received so far, oldest first. Always empty for a mailer that sends nothing. */
  delivered(): Promise<readonly SentMail[]>
  /**
   * Makes the **next** send fail on the far side, once: `rejected` is a permanent refusal
   * of the recipient, `transient` a temporary inability. Never called on a mailer that
   * sends nothing.
   */
  provoke(reason: 'rejected' | 'transient'): Promise<void>
  dispose?(): Promise<void>
}

export type MailerCapability = 'delivers' | 'sendsNothing'

const recipient = (address: string): EmailAddress => {
  const parsed = EmailAddress.create(address)
  if (!parsed.ok) throw new Error(`invalid fixture: ${parsed.error.code}`)
  return parsed.value
}

const aMail = (overrides: Partial<OutgoingMail> = {}): OutgoingMail => ({
  to: recipient('camille@example.org'),
  subject: 'Your invitation',
  text: 'Open the link to choose a password.',
  ...overrides,
})

const CR = String.fromCodePoint(0x0d)
const LF = String.fromCodePoint(0x0a)

export const mailerContract = (
  name: string,
  capability: MailerCapability,
  makeSubject: () => Promise<MailerSubject>,
): void => {
  describe(`Mailer contract: ${name}`, () => {
    let subject: MailerSubject

    // Fresh per case: a relay that was provoked, or that holds the previous case's mail,
    // would make every later assertion a statement about the order the cases ran in.
    beforeEach(async () => {
      subject = await makeSubject()
    })

    afterEach(async () => {
      await subject.dispose?.()
    })

    if (capability === 'sendsNothing') {
      describe('a mailer with no relay behind it', () => {
        it('says it cannot deliver, so a caller can show the link instead of waiting for a mail', () => {
          expect(subject.mailer.canDeliver).toBe(false)
        })

        it('fails with mail.notConfigured, which is the answer a caller turns into a link to copy', async () => {
          const result = await subject.mailer.send(aMail())

          expect(!result.ok && result.error.code).toBe('mail.notConfigured')
        })

        it('delivers nothing, however many times it is asked', async () => {
          await subject.mailer.send(aMail())
          await subject.mailer.send(aMail())

          expect(await subject.delivered()).toEqual([])
        })
      })
      return
    }

    describe('canDeliver', () => {
      it('says it can deliver', () => {
        expect(subject.mailer.canDeliver).toBe(true)
      })
    })

    describe('send', () => {
      it('delivers a plain-text message to its one recipient', async () => {
        const result = await subject.mailer.send(aMail())

        expect(result.ok).toBe(true)
        expect(await subject.delivered()).toEqual([
          {
            to: 'camille@example.org',
            subject: 'Your invitation',
            text: 'Open the link to choose a password.',
            html: null,
          },
        ])
      })

      it('carries the HTML alternative beside the text when one is given', async () => {
        const result = await subject.mailer.send(
          aMail({ html: '<p>Open the <a href="https://photos.example.org/i/1">link</a>.</p>' }),
        )

        expect(result.ok).toBe(true)
        const [delivered] = await subject.delivered()
        expect(delivered?.html).toBe(
          '<p>Open the <a href="https://photos.example.org/i/1">link</a>.</p>',
        )
        expect(delivered?.text).toBe('Open the link to choose a password.')
      })

      it('keeps accents and symbols in the subject and the body intact', async () => {
        // The mails this product sends are French first. Headers and bodies are encoded
        // differently on the wire, and each is a place for a character to be mangled.
        const title = 'Invitation à la fête de Camille — Événement'
        const text =
          'Bonjour Camille,\nVoici votre lien : https://photos.example.org/i/1\nÀ bientôt !'

        const result = await subject.mailer.send(aMail({ subject: title, text }))

        expect(result.ok).toBe(true)
        const [delivered] = await subject.delivered()
        expect(delivered?.subject).toBe(title)
        expect(delivered?.text).toBe(text)
      })

      it('delivers a body line that is a single dot without truncating the message there', async () => {
        const text = 'before\n.\nafter'

        const result = await subject.mailer.send(aMail({ text }))

        expect(result.ok).toBe(true)
        expect((await subject.delivered())[0]?.text).toBe(text)
      })

      it('delivers every message it is asked to, once each, and never deduplicates', async () => {
        // Whether to send a second reset link is the caller's decision, not the mailer's.
        await subject.mailer.send(aMail())
        await subject.mailer.send(aMail())

        expect(await subject.delivered()).toHaveLength(2)
      })
    })

    describe('a message that breaks the rules of checkOutgoingMail', () => {
      it('refuses a recipient that is really a list, and delivers to neither address', async () => {
        const list = recipient('a@example.org,b@example.com')

        const result = await subject.mailer.send(aMail({ to: list }))

        expect(!result.ok && result.error.code).toBe('mail.recipientInvalid')
        expect(await subject.delivered()).toEqual([])
      })

      it('refuses a subject with a line break in it, so a string cannot become a Bcc header', async () => {
        const injected = `Hello${CR}${LF}Bcc: attacker@example.net`

        const result = await subject.mailer.send(aMail({ subject: injected }))

        expect(!result.ok && result.error.code).toBe('mail.subjectInvalid')
        expect(await subject.delivered()).toEqual([])
      })

      it('refuses a message with no plain-text body', async () => {
        const result = await subject.mailer.send(aMail({ text: '  ' }))

        expect(!result.ok && result.error.code).toBe('mail.bodyInvalid')
        expect(await subject.delivered()).toEqual([])
      })
    })

    describe('a relay that will not take the message', () => {
      it('fails with mail.rejected when the recipient is refused for good, and delivers nothing', async () => {
        await subject.provoke('rejected')

        const result = await subject.mailer.send(aMail())

        expect(!result.ok && result.error.code).toBe('mail.rejected')
        expect(await subject.delivered()).toEqual([])
      })

      it('fails with mail.transient when the relay is only temporarily unable, so the caller may try again', async () => {
        await subject.provoke('transient')

        const result = await subject.mailer.send(aMail())

        expect(!result.ok && result.error.code).toBe('mail.transient')
        expect(await subject.delivered()).toEqual([])
      })

      it('carries no detail on the failure, so a relay reply cannot reach a page', async () => {
        await subject.provoke('rejected')

        const result = await subject.mailer.send(aMail())

        expect(!result.ok && result.error.details).toEqual({})
      })

      it('delivers the next message normally: a failure is not a state', async () => {
        await subject.provoke('transient')
        await subject.mailer.send(aMail())

        const retry = await subject.mailer.send(aMail({ subject: 'Second try' }))

        expect(retry.ok).toBe(true)
        expect((await subject.delivered()).map((mail) => mail.subject)).toEqual(['Second try'])
      })
    })
  })
}
