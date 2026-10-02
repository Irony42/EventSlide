import { createHmac, hkdfSync } from 'node:crypto'
import type { Request } from 'express'
import { describe, expect, it } from 'vitest'
import { AT } from '../../../application/testing/builders'
import { FakeClock } from '../../../application/testing/fakeClock'
import type { AuthState, UserRepository } from '../../../application/ports/userRepository'
import { TRUSTED_DEVICE_LIFETIME_MS } from '../../../domain/users/trustedDevice'
import { TRUSTED_DEVICE_COOKIE, trustedDeviceCodec, trustedDevices } from './trustedDevice'

/**
 * The trusted-device cookie's format and its reading (free plan G3-04b): what it holds, what it
 * is bound to, and everything that makes it not a cookie at all. The behaviour that follows
 * from it (a stranger on the same network, the epoch, the throttle) is held through the real
 * routes in `routes/authRoutes.trustedDevice.test.ts`.
 */

const SECRET = 'a-session-secret-of-more-than-32-characters'
const ADDRESS = 'camille@example.test'
/** Built here, so this file stays plain ASCII text. */
const E_ACUTE = String.fromCharCode(0xe9)
const NUL = String.fromCharCode(0)
const CLAIMS = { device: 'device-1', userId: 'user-1', issuedAtMs: 1_800_000_000_000 }

describe('the trusted-device cookie', () => {
  const codec = trustedDeviceCodec(SECRET)

  it('opens what it sealed, for the address it was sealed for', () => {
    expect(codec.open(codec.seal(CLAIMS, ADDRESS), ADDRESS)).toEqual(CLAIMS)
  })

  it('is v1.<payload>.<mac>, with the address in the signature and not in the payload', () => {
    const value = codec.seal(CLAIMS, ADDRESS)

    const [version, payload, mac, ...rest] = value.split('.')
    expect(version).toBe('v1')
    expect(rest).toEqual([])
    expect(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8'))).toEqual({
      d: 'device-1',
      u: 'user-1',
      i: CLAIMS.issuedAtMs,
    })
    expect(mac).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(value).not.toContain('camille')
  })

  it('is bound to the address: another address opens nothing, whatever it shares with the first', () => {
    const value = codec.seal(CLAIMS, ADDRESS)

    for (const other of [
      'autre@example.test',
      'camille@example.tes',
      'camille@example.test ',
      '',
    ]) {
      expect(codec.open(value, other)).toBeUndefined()
    }
  })

  it('is bound to the key: another secret opens nothing', () => {
    const value = codec.seal(CLAIMS, ADDRESS)

    expect(trustedDeviceCodec(`${SECRET}-rotated`).open(value, ADDRESS)).toBeUndefined()
  })

  it('opens nothing once any single character of it is changed', () => {
    const value = codec.seal(CLAIMS, ADDRESS)

    for (let at = 0; at < value.length; at += 1) {
      const replacement = value.charAt(at) === 'A' ? 'B' : 'A'
      const changed = `${value.slice(0, at)}${replacement}${value.slice(at + 1)}`
      expect(codec.open(changed, ADDRESS), `character ${at}`).toBeUndefined()
    }
  })

  it('opens nothing that is not a string, or is not a cookie of ours', () => {
    const real = codec.seal(CLAIMS, ADDRESS)
    const [, payload, mac] = real.split('.')

    const junk: unknown[] = [
      undefined,
      null,
      42,
      {},
      { a: 1 },
      [real],
      '',
      'v1',
      'v1.',
      'v1..',
      '..',
      `v2.${payload}.${mac}`,
      `V1.${payload}.${mac}`,
      `${real}.extra`,
      `${payload}.${mac}`,
      `v1.${payload}.${mac?.slice(1)}`,
      `v1.${payload}.${mac}A`,
      `v1.${'a'.repeat(5_000)}.${mac}`,
      'x'.repeat(100_000),
      // 43 characters, 86 bytes: the right length to a character count and the wrong one to
      // `timingSafeEqual`, which throws on it. A forged cookie must not be a 500.
      `v1.${payload}.${E_ACUTE.repeat(43)}`,
      `v1.${payload}.${NUL.repeat(43)}`,
      `v1.${payload}.${mac?.slice(0, 42)}${E_ACUTE}`,
      `v1.${payload}.${mac?.replace(/.$/, '=')}`,
    ]
    for (const value of junk) expect(codec.open(value, ADDRESS)).toBeUndefined()
  })

  describe('a payload that is signed but is not a device', () => {
    // The key is HKDF(SESSION_SECRET, "eventslide/trusted-device/v1"), and the MAC covers the
    // length-prefixed parts "v1", the payload and the address. Reproduced here so a test can
    // sign what the server never would, and see that the shape is still checked.
    const key = Buffer.from(
      hkdfSync('sha256', SECRET, Buffer.alloc(0), 'eventslide/trusted-device/v1', 32),
    )
    const part = (text: string): Buffer => Buffer.from(`${Buffer.byteLength(text)}:${text}`)
    const signed = (payload: string): string => {
      const mac = createHmac('sha256', key)
        .update(Buffer.concat([part('v1'), part(payload), part(ADDRESS)]))
        .digest('base64url')
      return `v1.${payload}.${mac}`
    }
    const encode = (value: unknown): string =>
      Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')

    it('is opened when it is the shape the server signs: the construction above is the one in use', () => {
      const value = signed(encode({ d: 'device-1', u: 'user-1', i: CLAIMS.issuedAtMs }))

      expect(codec.open(value, ADDRESS)).toEqual(CLAIMS)
    })

    it('is not opened when it is not JSON, nor the right object', () => {
      const wrong: unknown[] = [
        'not json at all',
        '[]',
        'null',
        '"text"',
        { d: 'device-1', u: 'user-1' },
        { d: 'device-1', i: 1 },
        { u: 'user-1', i: 1 },
        { d: '', u: 'user-1', i: 1 },
        { d: 'device-1', u: '', i: 1 },
        { d: 1, u: 'user-1', i: 1 },
        { d: 'device-1', u: 'user-1', i: '1' },
        { d: 'device-1', u: 'user-1', i: -1 },
        { d: 'device-1', u: 'user-1', i: 1.5 },
        { d: 'device-1', u: 'user-1', i: 1, extra: true },
        { d: 'x'.repeat(65), u: 'user-1', i: 1 },
        { d: 'device-1', u: 'x'.repeat(65), i: 1 },
      ]

      for (const payload of wrong) {
        expect(
          codec.open(signed(encode(payload)), ADDRESS),
          JSON.stringify(payload),
        ).toBeUndefined()
      }
    })
  })
})

describe('reading the cookie of a request', () => {
  const stateOf = (overrides: Partial<AuthState> = {}): AuthState => ({
    active: true,
    mustChangePassword: false,
    credentialsChangedAt: null,
    ...overrides,
  })

  const subject = (state: AuthState = stateOf()) => {
    const reads: string[] = []
    const clock = new FakeClock(AT)
    const users: Pick<UserRepository, 'authStateFor'> = {
      authStateFor: async (id) => {
        reads.push(id)
        return state
      },
    }
    const devices = trustedDevices({ secret: SECRET, clock, users, secureCookie: false })
    const codec = trustedDeviceCodec(SECRET)
    const requestWith = (value: unknown): Request =>
      ({ cookies: { [TRUSTED_DEVICE_COOKIE]: value } }) as unknown as Request
    const sealed = (overrides: Partial<typeof CLAIMS> = {}): string =>
      codec.seal({ ...CLAIMS, issuedAtMs: clock.now().getTime(), ...overrides }, ADDRESS)
    return { devices, reads, clock, requestWith, sealed }
  }

  it('recognises a cookie the key signed for this address, by its device id', async () => {
    const { devices, requestWith, sealed } = subject()

    expect(await devices.recognise(requestWith(sealed()), ADDRESS)).toBe('device-1')
    expect(await devices.recognise(requestWith(sealed()), ' CAMILLE@example.test ')).toBe(
      'device-1',
    )
  })

  it('recognises nothing on a request with no cookies at all', async () => {
    const { devices } = subject()

    expect(await devices.recognise({} as unknown as Request, ADDRESS)).toBeUndefined()
  })

  it('reads the account only for a cookie whose signature is valid for this address: a forged one never reaches storage', async () => {
    const { devices, reads, requestWith, sealed } = subject()

    await devices.recognise(requestWith('v1.e30.' + 'a'.repeat(43)), ADDRESS)
    await devices.recognise(requestWith(sealed()), 'autre@example.test')
    await devices.recognise(requestWith(undefined), ADDRESS)
    expect(reads).toEqual([])

    await devices.recognise(requestWith(sealed()), ADDRESS)
    expect(reads).toEqual(['user-1'])
  })

  it('applies the rule of the domain: expired, from the future, revoked and switched-off all recognise nothing', async () => {
    const stale = subject(stateOf({ credentialsChangedAt: new Date(AT.getTime() + 1) }))
    const off = subject(stateOf({ active: false }))
    const live = subject()

    expect(
      await stale.devices.recognise(stale.requestWith(stale.sealed()), ADDRESS),
    ).toBeUndefined()
    expect(await off.devices.recognise(off.requestWith(off.sealed()), ADDRESS)).toBeUndefined()
    expect(
      await live.devices.recognise(
        live.requestWith(live.sealed({ issuedAtMs: AT.getTime() + 1 })),
        ADDRESS,
      ),
    ).toBeUndefined()
    const cookie = live.sealed()
    live.clock.advance(TRUSTED_DEVICE_LIFETIME_MS)
    expect(await live.devices.recognise(live.requestWith(cookie), ADDRESS)).toBeUndefined()
  })
})
