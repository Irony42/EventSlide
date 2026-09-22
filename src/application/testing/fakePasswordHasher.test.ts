import { describe, expect, it } from 'vitest'
import { Password } from '../../domain/users/password'
import { FakePasswordHasher } from './fakePasswordHasher'

describe('FakePasswordHasher', () => {
  it('verifies the password it hashed and no other', async () => {
    const hasher = new FakePasswordHasher()
    const password = Password.create('une phrase de passe')
    if (!password.ok) throw new Error('fixture refused')

    const hash = await hasher.hash(password.value)

    expect(await hasher.verify('une phrase de passe', hash)).toBe(true)
    expect(await hasher.verify('une autre phrase', hash)).toBe(false)
    expect(hasher.verifications).toHaveLength(2)
    expect(hasher.needsRehash()).toBe(false)
  })
})
