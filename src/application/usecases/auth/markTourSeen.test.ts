import { describe, expect, it } from 'vitest'
import { asUserId } from '../../../domain/shared/ids'
import { AT } from '../../testing/builders'
import { FakeClock } from '../../testing/fakeClock'
import { FakeTourLedger } from '../../testing/fakeTourLedger'
import { makeMarkTourSeen } from './markTourSeen'

describe('markTourSeen', () => {
  const USER = asUserId('user-1')

  it('records the tour for the account, at the instant the clock gives', async () => {
    const tours = new FakeTourLedger().withAccounts(USER)
    const markTourSeen = makeMarkTourSeen({ tours, clock: new FakeClock(AT) })

    const result = await markTourSeen({ userId: USER, tour: 'eventPage' })

    expect(result.ok).toBe(true)
    expect(await tours.seenBy(USER)).toEqual(['eventPage'])
    expect(tours.seenAt(USER, 'eventPage')).toEqual(AT)
  })
})
