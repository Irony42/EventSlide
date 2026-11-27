import { createHash } from 'node:crypto'
import { anAccountToken } from '../../../application/testing/builders'
import { createSignupRequest } from '../../../domain/signups/signupRequest'
import { EmailAddress } from '../../../domain/users/emailAddress'
import type { SiteHarness } from './siteHarness'

export const A_SIGNUP = '88888888-8888-4888-8888-888888888888'
export const SIGNUPPER = 'camille@example.test'
export const SIGNUP_SPACE = 'Mariage de Léa et Hugo'

export interface SeededSignup {
  readonly id?: string
  readonly email?: string
  readonly clientName?: string
  readonly note?: string
  readonly eventDate?: string
  readonly locale?: 'fr' | 'en' | 'de' | 'es' | 'it'
  /** When the form was sent; the confirmation follows a minute later. Default: the harness clock. */
  readonly at?: Date
  /** Leave it `unconfirmed`: an unproven address, which an operator must never reach. */
  readonly unconfirmed?: boolean
}

/**
 * Plants a signup request the way the public routes will leave one: admitted with its confirmation
 * token, then confirmed into the operator's queue (`pending`). Through the real repository, so what the
 * routes read is what the adapter wrote.
 */
export const seedSignup = async (site: SiteHarness, input: SeededSignup = {}): Promise<string> => {
  const id = input.id ?? A_SIGNUP
  const email = EmailAddress.create(input.email ?? SIGNUPPER)
  if (!email.ok) throw new Error('fixture rejected: address')
  const sent = input.at ?? site.clock.now()
  const made = createSignupRequest(
    {
      id,
      email: email.value,
      clientName: input.clientName ?? SIGNUP_SPACE,
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.eventDate === undefined ? {} : { eventDate: input.eventDate }),
      locale: input.locale ?? 'fr',
    },
    sent,
  )
  if (!made.ok) throw new Error('fixture rejected: request')
  const token = anAccountToken({
    id: `c${id.slice(1)}`,
    tokenDigest: createHash('sha256').update(id).digest('hex'),
    purpose: 'emailVerification',
    email: email.value.value,
    userId: null,
    createdAt: sent,
  })
  const admitted = await site.repos.signups.admit({
    request: made.value,
    token,
    now: sent,
    maxPerDay: 1_000,
  })
  if (admitted.outcome !== 'created') throw new Error('fixture rejected: admission')
  if (input.unconfirmed !== true) {
    const confirmed = await site.repos.signups.confirm({
      tokenDigest: token.tokenDigest,
      now: new Date(sent.getTime() + 60_000),
      outcome: 'pending',
    })
    if (confirmed.kind !== 'confirmed') throw new Error('fixture rejected: confirmation')
  }
  return id
}
