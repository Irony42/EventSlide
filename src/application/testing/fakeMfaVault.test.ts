import { describe, expect, it } from 'vitest'
import { mfaVaultContract } from './contracts/mfaVaultContract'
import { FakeMfaVault } from './fakeMfaVault'

mfaVaultContract('fake', () => ({
  vault: new FakeMfaVault('key-a'),
  stranger: new FakeMfaVault('key-b'),
}))

describe('FakeMfaVault', () => {
  it('is deliberately readable, so a test can see what a use case stored', () => {
    const vault = new FakeMfaVault()
    const { sealed } = vault.seal(new TextEncoder().encode('abc'))

    expect(sealed.split('.')).toHaveLength(3)
    expect(sealed).not.toContain('abc')
  })

  it('can stand for a rotated key: the same label under another version opens nothing', () => {
    const { sealed } = new FakeMfaVault('key', 1).seal(new Uint8Array([1, 2, 3]))

    expect(new FakeMfaVault('key', 2).open(sealed, 2)).toBeNull()
  })
})
