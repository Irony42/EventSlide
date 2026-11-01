import { describe, expect, it } from 'vitest'
import { asPhotoId } from '../shared/ids'
import { planReel, type ReelPolicy } from './reelPlan'

const POLICY: ReelPolicy = { minPhotos: 3, maxPhotos: 5, secondsPerPhoto: 4 }
const at = (ms: number) => new Date(1_000_000 + ms)
const photo = (id: string, ms: number) => ({ id: asPhotoId(id), createdAt: at(ms) })

describe('planReel', () => {
  it('orders the photographs oldest first and sizes the reel from the policy', () => {
    const plan = planReel([photo('c', 30), photo('a', 10), photo('b', 20)], POLICY)

    expect(plan.ok && plan.value.order).toEqual(['a', 'b', 'c'])
    expect(plan.ok && plan.value.durationMs).toBe(12_000)
  })

  it('breaks a tie on the instant by id, so two renders agree', () => {
    const plan = planReel([photo('b', 10), photo('c', 10), photo('a', 10), photo('a', 10)], POLICY)

    expect(plan.ok && plan.value.order).toEqual(['a', 'a', 'b', 'c'])
  })

  it('accepts exactly the minimum and exactly the maximum', () => {
    expect(planReel([photo('a', 1), photo('b', 2), photo('c', 3)], POLICY).ok).toBe(true)
    const five = ['a', 'b', 'c', 'd', 'e'].map((id, index) => photo(id, index))
    expect(planReel(five, POLICY).ok).toBe(true)
  })

  it('refuses fewer than the minimum with reel.notEnoughPhotos', () => {
    const plan = planReel([photo('a', 1), photo('b', 2)], POLICY)

    expect(!plan.ok && plan.error.code).toBe('reel.notEnoughPhotos')
  })

  it('refuses more than the maximum with reel.tooManyPhotos, and never cuts one off', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => photo(id, index))
    const plan = planReel(six, POLICY)

    expect(!plan.ok && plan.error.code).toBe('reel.tooManyPhotos')
  })
})
