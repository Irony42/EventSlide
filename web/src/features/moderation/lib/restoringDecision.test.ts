import { describe, expect, it } from 'vitest'
import { restoringDecision } from './restoringDecision'

describe('restoringDecision', () => {
  it('takes back a publication of a pending item with a hide, said not to be exact', () => {
    expect(restoringDecision('pending', 'published')).toEqual({ decision: 'hide', exact: false })
  })

  it('does not offer to undo a refusal of a pending item', () => {
    expect(restoringDecision('pending', 'rejected')).toEqual({ decision: null, exact: false })
  })

  it('cannot undo a hidden item that was then refused', () => {
    expect(restoringDecision('hidden', 'rejected')).toEqual({ decision: null, exact: false })
  })

  it('restores the exact previous status when it is reachable', () => {
    expect(restoringDecision('published', 'hidden')).toEqual({ decision: 'publish', exact: true })
    expect(restoringDecision('hidden', 'published')).toEqual({ decision: 'hide', exact: true })
    expect(restoringDecision('rejected', 'published')).toEqual({ decision: 'reject', exact: true })
  })
})
