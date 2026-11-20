import { describe, expect, it } from 'vitest'
import { asPhotoId } from '../shared/ids'
import { pickCoverPhoto } from './bookCover'
import type { BookPlan, PlanPage } from './bookPlan'
import { COUNTS } from './testing/bookFixtures'

const planOf = (pages: PlanPage[], hearts: Record<string, number> = {}): BookPlan => ({
  chapters: [],
  pages,
  selectedCount: 0,
  counts: COUNTS,
  includedMessages: 0,
  extraMessages: 0,
  hearts,
  photographers: [],
  favouritesPage: null,
  guestbookPage: null,
})
const photoPage = (...ids: string[]): PlanPage => ({
  template: 'heroTwo',
  slots: ids.map((id) => ({ photoId: asPhotoId(id) })),
})

describe('pickCoverPhoto', () => {
  it('takes the most loved photograph', () => {
    expect(pickCoverPhoto(planOf([photoPage('a', 'b'), photoPage('c')], { b: 3, c: 5 }))).toBe('c')
  })
  it('takes the first in page order on a tie and when nobody gave a heart', () => {
    expect(pickCoverPhoto(planOf([photoPage('a', 'b')], { a: 2, b: 2 }))).toBe('a')
    expect(pickCoverPhoto(planOf([photoPage('x', 'y')]))).toBe('x')
  })
  it('does not count the reminder page of favourites', () => {
    const favourites: PlanPage = { template: 'favourites', slots: [{ photoId: asPhotoId('z') }] }
    expect(pickCoverPhoto(planOf([photoPage('a'), favourites], { z: 9 }))).toBe('a')
  })
  it('has none for a plan with no photograph', () => {
    expect(pickCoverPhoto(planOf([{ template: 'title', slots: [] }]))).toBeNull()
  })
})
