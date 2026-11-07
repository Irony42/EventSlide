import { describe, expect, it } from 'vitest'
import { asUserId } from '../../domain/shared/ids'
import { FakeAccountHoldings } from './fakeAccountHoldings'

const LEA = asUserId('usr-lea')
const TOM = asUserId('usr-tom')

describe('FakeAccountHoldings', () => {
  it('says an account holds nothing until a test says otherwise', async () => {
    expect(await new FakeAccountHoldings().countFor(LEA)).toEqual({
      events: 0,
      media: 0,
      reviews: 0,
      eventMemberships: 0,
    })
  })

  it('fills the counts a test names and leaves the others at zero', async () => {
    const holdings = new FakeAccountHoldings().holds(LEA, { events: 2, media: 40 })

    expect(await holdings.countFor(LEA)).toEqual({
      events: 2,
      media: 40,
      reviews: 0,
      eventMemberships: 0,
    })
  })

  it('keeps accounts apart, and a later statement replaces the earlier one whole', async () => {
    const holdings = new FakeAccountHoldings().holds(LEA, { events: 2 }).holds(TOM, { reviews: 1 })
    holdings.holds(LEA, { media: 5 })

    expect(await holdings.countFor(LEA)).toMatchObject({ events: 0, media: 5 })
    expect(await holdings.countFor(TOM)).toMatchObject({ reviews: 1 })
  })
})
