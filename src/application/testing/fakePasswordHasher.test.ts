import { describe, expect, it } from 'vitest'
import { Password } from '../../domain/users/password'
import { FakePasswordHasher } from './fakePasswordHasher'

const passwordOf = (value: string): Password => {
  const password = Password.create(value)
  if (!password.ok) throw new Error('fixture refused')
  return password.value
}

describe('FakePasswordHasher', () => {
  it('verifies the password it hashed and no other', async () => {
    const hasher = new FakePasswordHasher()

    const hash = await hasher.hash(passwordOf('une phrase de passe'))

    expect(await hasher.verify('une phrase de passe', hash)).toBe(true)
    expect(await hasher.verify('une autre phrase', hash)).toBe(false)
    expect(hasher.verifications).toHaveLength(2)
    expect(hasher.needsRehash('hash:anything')).toBe(false)
  })

  it('hashes to hash:<password>, the shape aUser() already uses', async () => {
    expect(await new FakePasswordHasher().hash(passwordOf('une phrase de passe'))).toBe(
      'hash:une phrase de passe',
    )
  })

  it('records what each comparison was for, in order', async () => {
    const hasher = new FakePasswordHasher()

    await hasher.verify('a', 'hash:a')
    await hasher.verify('b', hasher.dummyHash)

    expect(hasher.verifications).toEqual([
      { attempt: 'a', hash: 'hash:a' },
      { attempt: 'b', hash: hasher.dummyHash },
    ])
  })

  describe('produces', () => {
    it('answers what the test dictates, an empty string included', async () => {
      const hasher = new FakePasswordHasher({ produces: () => '' })

      expect(await hasher.hash(passwordOf('une phrase de passe'))).toBe('')
    })

    it('runs when `hash` does, so it can take time while it hashes', async () => {
      const ran: string[] = []
      const hasher = new FakePasswordHasher({
        produces: (password) => {
          ran.push(password.value)
          return 'hash:slow'
        },
      })
      expect(ran).toEqual([])

      await hasher.hash(passwordOf('une phrase de passe'))

      expect(ran).toEqual(['une phrase de passe'])
    })

    it('does not change what verifies: that is still hash:<attempt>', async () => {
      const hasher = new FakePasswordHasher({ produces: () => 'something-else' })

      expect(await hasher.verify('a', 'hash:a')).toBe(true)
      expect(await hasher.verify('a', 'something-else')).toBe(false)
    })
  })

  describe('stale and alsoVerifies', () => {
    const atTheOldCost = new FakePasswordHasher({
      stale: (hash) => hash.startsWith('legacy:'),
      alsoVerifies: (attempt) => `legacy:${attempt}`,
    })

    it('verifies a hash at the old cost, for the right password only', async () => {
      expect(await atTheOldCost.verify('a', 'legacy:a')).toBe(true)
      expect(await atTheOldCost.verify('a', 'legacy:b')).toBe(false)
    })

    it('calls only the hashes the test names stale', () => {
      expect(atTheOldCost.needsRehash('legacy:a')).toBe(true)
      expect(atTheOldCost.needsRehash('hash:a')).toBe(false)
    })

    it('verifies no other shape unless it was given one', async () => {
      expect(await new FakePasswordHasher().verify('a', 'legacy:a')).toBe(false)
    })
  })

  describe('gate', () => {
    it('holds every comparison open until it is let go, having recorded that each started', async () => {
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const hasher = new FakePasswordHasher({ gate })

      const answers = Promise.all([hasher.verify('a', 'hash:a'), hasher.verify('b', 'hash:a')])
      await Promise.resolve()

      expect(hasher.verifications).toHaveLength(2)
      let settled = false
      void answers.then(() => {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBe(false)

      release()

      expect(await answers).toEqual([true, false])
    })
  })
})
