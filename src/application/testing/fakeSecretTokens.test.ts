import { describe, expect, it } from 'vitest'
import { secretTokensContract } from './contracts/secretTokensContract'
import { FakeSecretTokens } from './fakeSecretTokens'

secretTokensContract('fake', () => new FakeSecretTokens())

describe('FakeSecretTokens', () => {
  it('mints readable, numbered tokens, so a test can name the one a mail carried', () => {
    const tokens = new FakeSecretTokens()

    expect([tokens.mint().token, tokens.mint().token]).toEqual(['secret-1', 'secret-2'])
  })
})
