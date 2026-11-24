import { createPublicKey, createECDH, createDecipheriv, hkdfSync, verify } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  MAX_PLAINTEXT_BYTES,
  RECORD_SIZE,
  VAPID_LIFETIME_SECONDS,
  encryptAes128gcm,
  generateVapidKeys,
  vapidAuthorization,
  vapidKeysMatch,
  vapidToken,
} from './webPushCrypto'

/**
 * RFC 8291, section 5 and appendix A: the worked example. The body this module writes for the
 * example's keys, salt and plaintext must be the RFC's, byte for byte (the strings below are copied
 * from the RFC, whitespace removed).
 */
const b64 = (text: string): Buffer => Buffer.from(text.replace(/\s+/gu, ''), 'base64url')

const RFC = {
  plaintext: Buffer.from('When I grow up, I want to be a watermelon', 'utf8'),
  authSecret: b64('BTBZMqHH6r4Tts7J_aSIgg'),
  uaPublic: b64(
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcx aOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  ),
  uaPrivate: b64('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94'),
  asPrivate: b64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
  asPublic: b64(
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  ),
  salt: b64('DGv6ra1nlYgDCS1FRnbzlw'),
  body: b64(`
    DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
    mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
    pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`),
}

describe('RFC 8291 appendix A', () => {
  it('writes the very body of the worked example, byte for byte', () => {
    const body = encryptAes128gcm({
      plaintext: RFC.plaintext,
      uaPublic: RFC.uaPublic,
      authSecret: RFC.authSecret,
      senderPrivate: RFC.asPrivate,
      salt: RFC.salt,
    })

    // The RFC's request shows `Content-Length: 145`, an erratum: 86 of header + 41 of text + the delimiter + the tag is 144.
    expect(body.length).toBe(144)
    expect(body.toString('base64url')).toBe(RFC.body.toString('base64url'))
    expect(body.equals(RFC.body)).toBe(true)
  })

  it('writes the 86-octet header the RFC shows: the salt, the record size 4096, the sender key', () => {
    const body = encryptAes128gcm({
      plaintext: RFC.plaintext,
      uaPublic: RFC.uaPublic,
      authSecret: RFC.authSecret,
      senderPrivate: RFC.asPrivate,
      salt: RFC.salt,
    })

    expect(body.subarray(0, 16).equals(RFC.salt)).toBe(true)
    expect(body.readUInt32BE(16)).toBe(RECORD_SIZE)
    expect(body.readUInt8(20)).toBe(65)
    expect(body.subarray(21, 86).equals(RFC.asPublic)).toBe(true)
  })

  it('is decrypted by the browser’s side: the receiver recovers the plaintext and the delimiter', () => {
    const body = encryptAes128gcm({
      plaintext: RFC.plaintext,
      uaPublic: RFC.uaPublic,
      authSecret: RFC.authSecret,
    })

    // The receiver's computation of RFC 8291, section 3.4, from its private key.
    const salt = body.subarray(0, 16)
    const asPublic = body.subarray(21, 86)
    const receiver = createECDH('prime256v1')
    receiver.setPrivateKey(RFC.uaPrivate)
    const shared = receiver.computeSecret(asPublic)
    const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), RFC.uaPublic, asPublic])
    const ikm = Buffer.from(hkdfSync('sha256', shared, RFC.authSecret, keyInfo, 32))
    const key = Buffer.from(
      hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
    )
    const nonce = Buffer.from(
      hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12),
    )
    const record = body.subarray(86)
    const decipher = createDecipheriv('aes-128-gcm', key, nonce)
    decipher.setAuthTag(record.subarray(record.length - 16))
    const opened = Buffer.concat([
      decipher.update(record.subarray(0, record.length - 16)),
      decipher.final(),
    ])

    expect(opened.subarray(0, opened.length - 1).toString('utf8')).toBe(RFC.plaintext.toString())
    expect(opened[opened.length - 1]).toBe(2)
  })

  it('draws a fresh salt and sender key each time, so two bodies of one message differ', () => {
    const make = () =>
      encryptAes128gcm({
        plaintext: RFC.plaintext,
        uaPublic: RFC.uaPublic,
        authSecret: RFC.authSecret,
      })

    expect(make().equals(make())).toBe(false)
  })

  it('takes a payload that fills the record exactly, and refuses one byte more', () => {
    const fill = (length: number) =>
      encryptAes128gcm({
        plaintext: Buffer.alloc(length, 97),
        uaPublic: RFC.uaPublic,
        authSecret: RFC.authSecret,
      })

    expect(MAX_PLAINTEXT_BYTES).toBe(3993)
    expect(fill(MAX_PLAINTEXT_BYTES).length).toBe(RECORD_SIZE)
    expect(() => fill(MAX_PLAINTEXT_BYTES + 1)).toThrow(/too long/)
  })

  it('refuses a key or a secret of the wrong length, and a point that is not on the curve', () => {
    const base = { plaintext: RFC.plaintext, uaPublic: RFC.uaPublic, authSecret: RFC.authSecret }

    expect(() => encryptAes128gcm({ ...base, uaPublic: RFC.uaPublic.subarray(0, 64) })).toThrow()
    expect(() =>
      encryptAes128gcm({ ...base, authSecret: RFC.authSecret.subarray(0, 15) }),
    ).toThrow()
    const offCurve = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)])
    expect(() => encryptAes128gcm({ ...base, uaPublic: offCurve })).toThrow()
  })
})

describe('VAPID, RFC 8292', () => {
  const keys = generateVapidKeys()
  const input = {
    audience: 'https://fcm.googleapis.com',
    subject: 'mailto:ops@example.org',
    ...keys,
    nowSeconds: 1_700_000_000,
  }
  const parts = (token: string): [string, string, Buffer] => {
    const [h, c, s] = token.split('.') as [string, string, string]
    return [h, c, Buffer.from(s, 'base64url')]
  }

  it('is an ES256 token over the audience, an expiry within a day and the subject', () => {
    const [header, claims] = parts(vapidToken(input))

    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      typ: 'JWT',
      alg: 'ES256',
    })
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: 1_700_000_000 + VAPID_LIFETIME_SECONDS,
      sub: 'mailto:ops@example.org',
    })
    expect(VAPID_LIFETIME_SECONDS).toBeLessThanOrEqual(24 * 3600)
  })

  it('is signed in the raw 64-byte r||s form, and the box’s public key verifies it', () => {
    const token = vapidToken(input)
    const [header, claims, signature] = parts(token)
    const point = Buffer.from(keys.publicKey, 'base64url')
    const publicKey = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33, 65).toString('base64url'),
      },
      format: 'jwk',
    })

    expect(signature.length).toBe(64)
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${claims}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        signature,
      ),
    ).toBe(true)
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${claims}x`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        signature,
      ),
    ).toBe(false)
  })

  it('writes the header as `vapid t=<token>, k=<public key>`', () => {
    const header = vapidAuthorization(input)

    expect(header).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/u)
    expect(header.endsWith(`k=${keys.publicKey}`)).toBe(true)
  })

  it('refuses a key of the wrong length', () => {
    expect(() => vapidToken({ ...input, privateKey: 'AAAA' })).toThrow(/wrong length/)
    expect(() => vapidToken({ ...input, publicKey: 'AAAA' })).toThrow(/wrong length/)
  })

  it('left-pads a private key that lost its leading zero byte, and refuses what is not a P-256 pair', () => {
    const short = Buffer.alloc(31, 9)
    const point = Buffer.alloc(65, 4)
    const stub = (scalar: Buffer, publicKey: Buffer) => () => ({
      generateKeys: () => undefined,
      getPrivateKey: () => scalar,
      getPublicKey: () => publicKey,
    })

    const pair = generateVapidKeys(stub(short, point))

    expect(pair.privateKey).toHaveLength(43)
    expect(Buffer.from(pair.privateKey, 'base64url')).toEqual(
      Buffer.concat([Buffer.alloc(1), short]),
    )
    expect(pair.publicKey).toHaveLength(87)
    expect(() => generateVapidKeys(stub(Buffer.alloc(33), point))).toThrow()
    expect(() => generateVapidKeys(stub(short, Buffer.alloc(33)))).toThrow()
  })

  it('generates a pair that matches, and says when the two halves come from different pairs', () => {
    const other = generateVapidKeys()

    expect(keys.publicKey).toHaveLength(87)
    expect(keys.privateKey).toHaveLength(43)
    expect(vapidKeysMatch(keys.publicKey, keys.privateKey)).toBe(true)
    expect(vapidKeysMatch(other.publicKey, keys.privateKey)).toBe(false)
    expect(vapidKeysMatch('x', 'y')).toBe(false)
  })
})
