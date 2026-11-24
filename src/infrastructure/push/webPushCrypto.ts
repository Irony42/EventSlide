import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
} from 'node:crypto'

/**
 * Web Push's cryptography **with no dependency** (spec 30, lot 4): only `node:crypto`.
 *
 * - **Message encryption**, RFC 8291 with the `aes128gcm` content coding of RFC 8188: an ECDH
 *   agreement on P-256 between a key the box makes for the message and the browser's `p256dh`, mixed
 *   with the browser's authentication secret by HKDF-SHA-256, then AES-128-GCM over **one record**.
 *   A payload that does not fit one record is refused, not split.
 * - **VAPID**, RFC 8292: an ES256 JSON Web Token over the push service's origin, signed with the
 *   box's own key, in the `Authorization: vapid t=…, k=…` header. The signature is the raw 64-byte
 *   r||s form a JWT wants (`dsaEncoding: 'ieee-p1363'`), not Node's default DER.
 *
 * Tested against the worked example of RFC 8291, appendix A, byte for byte.
 */

const SALT_BYTES = 16
const AUTH_BYTES = 16
const PUBLIC_KEY_BYTES = 65
const PRIVATE_KEY_BYTES = 32
/** The record size the header declares: 4096, what every push service takes. */
export const RECORD_SIZE = 4096
/** The header is the salt, the record size, the key id length and the sender's 65-byte key. */
const HEADER_BYTES = SALT_BYTES + 4 + 1 + PUBLIC_KEY_BYTES
const TAG_BYTES = 16
/** The most one record holds: its size less the header, the tag and the delimiter octet. */
export const MAX_PLAINTEXT_BYTES = RECORD_SIZE - HEADER_BYTES - TAG_BYTES - 1

const utf8 = (text: string): Buffer => Buffer.from(text, 'utf8')

export interface EncryptInput {
  readonly plaintext: Buffer
  /** The browser's `p256dh`: an uncompressed P-256 point, 65 bytes. */
  readonly uaPublic: Buffer
  /** The browser's `auth`: 16 bytes. */
  readonly authSecret: Buffer
  /** Only for the worked example: the message key, 32 bytes. Drawn fresh when absent. */
  readonly senderPrivate?: Buffer
  /** Only for the worked example: 16 bytes. Drawn fresh when absent. */
  readonly salt?: Buffer
}

/**
 * The body of a push request: header and one encrypted record. **Throws** for a payload that is too
 * long, a key or secret of the wrong length, or a browser key that is not a point of the curve (the
 * sender turns that into "this subscription can never work").
 */
export const encryptAes128gcm = (input: EncryptInput): Buffer => {
  const { plaintext, uaPublic, authSecret } = input
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('push payload too long')
  if (uaPublic.length !== PUBLIC_KEY_BYTES) throw new Error('push key of the wrong length')
  if (authSecret.length !== AUTH_BYTES) throw new Error('push secret of the wrong length')

  const ecdh = createECDH('prime256v1')
  if (input.senderPrivate === undefined) ecdh.generateKeys()
  else ecdh.setPrivateKey(input.senderPrivate)
  const asPublic = ecdh.getPublicKey()
  // Throws for a point that is not on the curve.
  const shared = ecdh.computeSecret(uaPublic)
  const salt = input.salt ?? randomBytes(SALT_BYTES)

  // RFC 8291, section 3.4: the key material is mixed with the authentication secret first...
  const keyInfo = Buffer.concat([utf8('WebPush: info\0'), uaPublic, asPublic])
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32))
  // ...then the content encryption key and the nonce come from it and the salt (RFC 8188, section 2.2).
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, utf8('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, utf8('Content-Encoding: nonce\0'), 12))

  const cipher = createCipheriv('aes-128-gcm', key, nonce)
  // 0x02 closes the only, and last, record.
  const record = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ])

  const header = Buffer.alloc(HEADER_BYTES)
  salt.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, SALT_BYTES)
  header.writeUInt8(PUBLIC_KEY_BYTES, SALT_BYTES + 4)
  asPublic.copy(header, SALT_BYTES + 5)
  return Buffer.concat([header, record])
}

// ---- VAPID ---------------------------------------------------------------------------------

const base64url = (data: Buffer | string): string =>
  (typeof data === 'string' ? utf8(data) : data).toString('base64url')

/** What a VAPID token may live: RFC 8292 says no more than 24 hours; this box asks for twelve. */
export const VAPID_LIFETIME_SECONDS = 12 * 3600

export interface VapidInput {
  /** The push service's origin (`https://fcm.googleapis.com`): the token's audience. */
  readonly audience: string
  /** `mailto:` or `https:` address the push service may reach the operator at. */
  readonly subject: string
  /** 65 bytes, base64url. */
  readonly publicKey: string
  /** 32 bytes, base64url. */
  readonly privateKey: string
  /** Seconds since the epoch. */
  readonly nowSeconds: number
}

/** The JWT of RFC 8292: `{typ, alg}.{aud, exp, sub}.signature`, ES256, signature in r||s form. */
export const vapidToken = (input: VapidInput): string => {
  const publicBytes = Buffer.from(input.publicKey, 'base64url')
  const privateBytes = Buffer.from(input.privateKey, 'base64url')
  if (publicBytes.length !== PUBLIC_KEY_BYTES || privateBytes.length !== PRIVATE_KEY_BYTES) {
    throw new Error('VAPID key of the wrong length')
  }
  const signingInput = `${base64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${base64url(
    JSON.stringify({
      aud: input.audience,
      exp: input.nowSeconds + VAPID_LIFETIME_SECONDS,
      sub: input.subject,
    }),
  )}`
  const key = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: input.privateKey,
      x: base64url(publicBytes.subarray(1, 33)),
      y: base64url(publicBytes.subarray(33, 65)),
    },
    format: 'jwk',
  })
  const signature = sign('sha256', utf8(signingInput), { key, dsaEncoding: 'ieee-p1363' })
  return `${signingInput}.${base64url(signature)}`
}

/** The `Authorization` header value: `vapid t=<jwt>, k=<public key>`. */
export const vapidAuthorization = (input: VapidInput): string =>
  `vapid t=${vapidToken(input)}, k=${input.publicKey}`

export interface VapidKeyPair {
  readonly publicKey: string
  readonly privateKey: string
}

/** The part of an ECDH key pair this needs: injected by the test of a short scalar. */
export interface KeyMaker {
  generateKeys(): unknown
  getPublicKey(): Buffer
  getPrivateKey(): Buffer
}

/**
 * A new pair, for the operator's one-time `generateVapidKeys` script. `getPrivateKey()` drops leading zero
 * bytes (about one key in 256 is 31 bytes long), so the scalar is left-padded to its 32 bytes: a short
 * key would be refused at boot by the length check, and would not be a key a push service can verify.
 */
export const generateVapidKeys = (
  make: () => KeyMaker = () => createECDH('prime256v1'),
): VapidKeyPair => {
  const ecdh = make()
  ecdh.generateKeys()
  const scalar = ecdh.getPrivateKey()
  const publicKey = ecdh.getPublicKey()
  if (scalar.length > PRIVATE_KEY_BYTES || publicKey.length !== PUBLIC_KEY_BYTES) {
    throw new Error('the key pair is not a P-256 pair')
  }
  const padded = Buffer.concat([Buffer.alloc(PRIVATE_KEY_BYTES - scalar.length), scalar])
  return { publicKey: base64url(publicKey), privateKey: base64url(padded) }
}

/** Whether the public key is the one that goes with the private key (a pair pasted half from another). */
export const vapidKeysMatch = (publicKey: string, privateKey: string): boolean => {
  try {
    const ecdh = createECDH('prime256v1')
    ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'))
    return ecdh.getPublicKey().equals(Buffer.from(publicKey, 'base64url'))
  } catch {
    return false
  }
}
