import { describe, expect, it } from 'vitest'
import { ACCOUNT_CHANGE_KINDS, accountChangeMail } from './accountChangeMail'
import {
  eventClosedMail,
  invitationAcceptedMail,
  jobDoneMail,
  windowEndingMail,
} from './eventNoticeMails'
import type { OutgoingMail } from './outgoingMail'
import { rsvpDeadlineMail, rsvpDigestMail, rsvpFullMail, rsvpStoppedMail } from './rsvpFamilyMails'
import { rsvpErasureMail } from './rsvpNoticeMails'
import { TAKEDOWN_KINDS, takedownMail } from './takedownMail'
import type { RsvpFigures } from '../notices/rsvpFigures'
import { EmailAddress } from '../users/emailAddress'

/**
 * French puts a no-break space before `:` `;` `!` `?` and inside « ». Every French mail the notices send (spec 32: the account
 * changes, the event's jobs, the replies' calendar, the operator's acts) is rendered here in every variant its input changes, and
 * not one line may carry a plain space in those places: an editor shows both as the same blank, so only a test keeps them apart.
 */

const address = (value: string): EmailAddress => {
  const made = EmailAddress.create(value)
  if (!made.ok) throw new Error('bad address in the test')
  return made.value
}

const to = address('hote@example.test')
const contact = address('operateur@example.test')
const AT = new Date('2026-11-27T14:32:00.000Z')
const LATER = new Date('2027-01-15T08:00:00.000Z')
const base = { to, locale: 'fr' as const, eventName: 'Mariage de Léa', pageUrl: 'https://x.test/a' }

const FIGURES: RsvpFigures = {
  yes: { responses: 3, people: 7, adults: 5, kids: 2 },
  maybe: { responses: 1, people: 2 },
  no: { responses: 2 },
  waitlist: { responses: 1, people: 1 },
  dietCount: 2,
  meals: [{ label: 'Végétarien', count: 3 }],
  noReplyHouseholds: 4,
}
const QUIET: RsvpFigures = { ...FIGURES, dietCount: 0, meals: [], noReplyHouseholds: 0 }

const mails = (): readonly (readonly [string, OutgoingMail])[] => [
  ...ACCOUNT_CHANGE_KINDS.flatMap((kind) =>
    [null, contact].map(
      (replyTo) =>
        [
          `accountChange ${kind}`,
          accountChangeMail({
            to,
            locale: 'fr',
            kind,
            at: AT,
            forgotUrl: 'https://x.test/password/forgot',
            replyTo,
          }),
        ] as const,
    ),
  ),
  ...(['archive', 'book', 'reel'] as const).flatMap((job) =>
    (['done', 'failed'] as const).map(
      (outcome) => [`job ${job} ${outcome}`, jobDoneMail({ ...base, job, outcome })] as const,
    ),
  ),
  ...[0, 1, 5].flatMap(
    (n) =>
      [
        [
          `eventClosed ${n}`,
          eventClosedMail({ ...base, photos: n, videos: n, messages: n + 1, deleteAt: LATER }),
        ],
        [
          `eventClosed ${n} without a deletion`,
          eventClosedMail({ ...base, photos: n, videos: 0, messages: 0, deleteAt: null }),
        ],
      ] as const,
  ),
  ['windowEnding', windowEndingMail({ ...base, endsAt: LATER, timeZone: 'Europe/Paris' })],
  ['invitationAccepted', invitationAcceptedMail({ ...base, who: 'Camille', role: 'moderator' })],
  ...[0, 1, 12].map(
    (replies) =>
      [
        `rsvpErasure ${replies}`,
        rsvpErasureMail({
          to,
          locale: 'fr',
          eventName: base.eventName,
          erasureDate: LATER,
          replies,
          pageUrl: base.pageUrl,
        }),
      ] as const,
  ),
  ...[1, 4].flatMap(
    (changed) =>
      [
        [
          `rsvpDigest ${changed}`,
          rsvpDigestMail({ ...base, changed, figures: FIGURES, pendingNotes: 2 }),
        ],
        [
          `rsvpDigest ${changed} quiet`,
          rsvpDigestMail({ ...base, changed, figures: QUIET, pendingNotes: 0 }),
        ],
      ] as const,
  ),
  ['rsvpDeadline', rsvpDeadlineMail({ ...base, unanswered: 3, deadline: '2027-01-15' })],
  ['rsvpDeadline one', rsvpDeadlineMail({ ...base, unanswered: 1, deadline: '2027-01-15' })],
  ['rsvpStopped', rsvpStoppedMail({ ...base, figures: FIGURES })],
  ['rsvpStopped quiet', rsvpStoppedMail({ ...base, figures: QUIET })],
  ['rsvpFull', rsvpFullMail({ ...base, capacity: 80 })],
  ...TAKEDOWN_KINDS.flatMap((kind) =>
    [
      { reason: null, replyTo: null },
      { reason: 'Un contenu a été signalé', replyTo: contact },
    ].map(
      ({ reason, replyTo }) =>
        [
          `takedown ${kind} ${reason === null ? 'plain' : 'with a reason'}`,
          takedownMail({
            to,
            locale: 'fr',
            kind,
            name: 'Mariage de Léa',
            at: AT,
            reason,
            replyTo,
            purgeAt: LATER,
          }),
        ] as const,
    ),
  ),
]

/** The places where a plain space is wrong in French: before `: ; ! ?`, after « and before ». */
const PLAIN_SPACE = / [:;!?]|« | »/u

describe('the French mails of the notices', () => {
  const rendered = mails()

  it('renders every variant, so that the check below reads something', () => {
    expect(rendered.length).toBeGreaterThan(50)
  })

  it.each(rendered.map(([name, mail]) => [name, mail] as const))(
    '%s: no plain space before : ; ! ? nor inside « », in the subject or in any line',
    (_name, mail) => {
      const lines = [mail.subject, ...mail.text.split('\n')]
      const offending = lines.filter((line) => PLAIN_SPACE.test(line))

      expect(offending).toEqual([])
    },
  )
})
