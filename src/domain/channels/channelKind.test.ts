import { describe, expect, it } from 'vitest'

import { CHANNEL_KINDS, isChannelKind, parseChannelKind } from './channelKind'

describe('channel kinds', () => {
  it('knows Telegram and only Telegram so far', () => {
    expect(CHANNEL_KINDS).toEqual(['telegram'])
  })

  it('parses a known kind', () => {
    expect(parseChannelKind('telegram')).toEqual({ ok: true, value: 'telegram' })
  })

  it.each(['whatsapp', '', 'Telegram', 42, null, undefined])(
    'refuses %j with a stable code, so a stored value is never trusted blindly',
    (value) => {
      const parsed = parseChannelKind(value)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.error.code).toBe('channel.unknownKind')
      expect(isChannelKind(value)).toBe(false)
    },
  )
})
