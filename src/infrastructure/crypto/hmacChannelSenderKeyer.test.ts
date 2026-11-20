import { describe, expect, it } from 'vitest'
import { createHmacChannelSenderKeyer } from './hmacChannelSenderKeyer'

const SECRET = 'a-guest-token-secret-of-at-least-32-chars'

describe('createHmacChannelSenderKeyer', () => {
  it('gives the same key for the same material, and a 64 character hex digest', () => {
    const keyer = createHmacChannelSenderKeyer(SECRET)

    expect(keyer.keyOf('telegram:e1:42')).toBe(keyer.keyOf('telegram:e1:42'))
    expect(keyer.keyOf('telegram:e1:42')).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('gives another key for another sender, another event or another channel', () => {
    const keyer = createHmacChannelSenderKeyer(SECRET)
    const keys = new Set([
      keyer.keyOf('telegram:e1:42'),
      keyer.keyOf('telegram:e1:43'),
      keyer.keyOf('telegram:e2:42'),
      keyer.keyOf('whatsapp:e1:42'),
    ])

    expect(keys.size).toBe(4)
  })

  it('depends on the secret, and never contains the account number', () => {
    const other = createHmacChannelSenderKeyer(`${SECRET}-other`)
    const keyer = createHmacChannelSenderKeyer(SECRET)

    expect(keyer.keyOf('telegram:e1:424242')).not.toBe(other.keyOf('telegram:e1:424242'))
    expect(keyer.keyOf('telegram:e1:424242')).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('pins the construction with a literal, since a change would orphan every channel guest', () => {
    expect(createHmacChannelSenderKeyer(SECRET).keyOf('telegram:e1:42')).toBe(PINNED)
  })

  it('refuses a short secret', () => {
    expect(() => createHmacChannelSenderKeyer('short')).toThrow(/32\+/u)
  })
})

const PINNED = 'a3a18d9c899664092ed59ffd351b2bf1613650155169fd73be8c9a14f4c3f116'
