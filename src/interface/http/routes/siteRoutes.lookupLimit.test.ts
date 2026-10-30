import { describe, expect, it } from 'vitest'
import { aUser } from '../../../application/testing/builders'
import { CapturingLogger } from '../../../application/testing/capturingLogger'
import {
  SITE_LOOKUPS_PER_ACCOUNT_PER_MINUTE,
  SITE_LOOKUPS_PER_ADDRESS_PER_MINUTE,
} from '../middleware/rateLimit'
import { CONTENT, aBox } from '../testing/siteBox'

/**
 * The operator's lookup is limited, and logs who looked and how long, never what (launch review
 * S5). A join code is a bearer credential: an unlimited lookup from a hijacked operator session
 * would be an oracle for guessing them, so the route answers `429` past a few a minute, **per
 * account and per address**, each held by its own case.
 */

describe('GET /api/site/events/lookup, limited', () => {
  it('answers 429 with Retry-After past the account budget, and the budget is not shared with the other reads', async () => {
    const { site } = await aBox()
    const operator = await site.signInAsOperator()

    for (let n = 0; n < SITE_LOOKUPS_PER_ACCOUNT_PER_MINUTE; n += 1) {
      expect(
        (await operator.agent.get(`/api/site/events/lookup?q=${CONTENT.joinCode}`)).status,
      ).toBe(200)
    }
    const refused = await operator.agent.get(`/api/site/events/lookup?q=${CONTENT.joinCode}`)

    expect(refused.status).toBe(429)
    expect(refused.headers['retry-after']).toBeDefined()
    expect((await operator.agent.get('/api/site/clients')).status).toBe(200)
  })

  it('answers 429 past the address budget even when no single account has spent its own', async () => {
    const { site } = await aBox()
    const operators = ['un', 'deux', 'trois', 'quatre'].map(
      (word) => `${word}@operateur.example.test`,
    )
    for (const [index, email] of operators.entries()) {
      await site.addAccount(
        aUser({ id: `0000000${index}-0000-4000-8000-000000000000`, email, siteRole: 'operator' }),
      )
    }
    const callers = await Promise.all(operators.map((email) => site.signIn(email)))

    let answered = 0
    let firstRefusal = -1
    for (let n = 0; n < SITE_LOOKUPS_PER_ADDRESS_PER_MINUTE + 2; n += 1) {
      const caller = callers[n % callers.length]
      const response = await caller?.agent.get(`/api/site/events/lookup?q=${CONTENT.joinCode}`)
      if (response?.status === 429 && firstRefusal === -1) firstRefusal = n
      if (response?.status === 200) answered += 1
    }

    // Each of the four spent at most eight, under the account budget of ten: the address stopped it.
    expect(answered).toBe(SITE_LOOKUPS_PER_ADDRESS_PER_MINUTE)
    expect(firstRefusal).toBe(SITE_LOOKUPS_PER_ADDRESS_PER_MINUTE)
  })

  it('logs one line per lookup with the operator and the length of the query, never the query', async () => {
    const logger = new CapturingLogger()
    const { site } = await aBox({ logger })
    const operator = await site.signInAsOperator()

    await operator.agent.get(`/api/site/events/lookup?q=${CONTENT.joinCode}`)
    await operator.agent.get(`/api/site/events/lookup?q=${encodeURIComponent(CONTENT.eventName)}`)

    const lines = logger.lines.filter((line) => line.message === 'an operator looked up an event')
    expect(lines.map((line) => line.context?.['queryLength'])).toEqual([
      CONTENT.joinCode.length,
      CONTENT.eventName.length,
    ])
    const everything = JSON.stringify(logger.lines)
    for (const typed of [CONTENT.joinCode, CONTENT.eventName, CONTENT.slug]) {
      expect(everything).not.toContain(typed)
    }
  })
})
