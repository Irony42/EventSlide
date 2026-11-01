import { describe, expect, it } from 'vitest'
import { truncateName } from './truncateName'

describe('truncateName', () => {
  it('leaves a name within the limit alone', () => {
    expect(truncateName('Léa')).toBe('Léa')
  })

  it('cuts a long name with an ellipsis', () => {
    expect(truncateName('a'.repeat(120))).toBe(`${'a'.repeat(40)}…`)
  })

  it('never cuts a character in half', () => {
    expect(truncateName('😀😀😀', 2)).toBe('😀😀…')
  })
})
