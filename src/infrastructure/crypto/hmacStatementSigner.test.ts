import { describe, expect, it } from 'vitest'
import {
  TRUSTED_DEVICE_SIGNER_LABEL,
  createHmacStatementSigner,
  createTrustedDeviceSigner,
} from './hmacStatementSigner'

const SECRET = 'a-session-secret-of-more-than-32-characters'
const PAYLOAD = 'eyJkIjoiZGV2aWNlLTEiLCJ1IjoidXNlci0xIiwiaSI6MTgwMDAwMDAwMDAwMH0'
const STATEMENT = ['v1', PAYLOAD, 'camille@example.test']

describe('createHmacStatementSigner', () => {
  const signer = createHmacStatementSigner({
    rootSecret: SECRET,
    label: TRUSTED_DEVICE_SIGNER_LABEL,
  })

  it('signs the trusted-device statement with the bytes the cookie has always carried', () => {
    // A literal taken from the two copies this adapter replaced (ARCH-04): the cookie MAC of
    // `middleware/trustedDevice.test.ts`. A cookie issued before the upgrade must still verify.
    expect(signer.sign(STATEMENT)).toBe('Wj00qUbDp0w89-5rkukw0nsmI2rTF8zkHHW4A68WjU0')
    expect(signer.verify(STATEMENT, 'Wj00qUbDp0w89-5rkukw0nsmI2rTF8zkHHW4A68WjU0')).toBe(true)
  })

  it('is what the container builds for the device cookie: the same bytes under the same label', () => {
    expect(createTrustedDeviceSigner(SECRET).sign(STATEMENT)).toBe(
      'Wj00qUbDp0w89-5rkukw0nsmI2rTF8zkHHW4A68WjU0',
    )
  })

  it('keeps the label as the domain separation: another label signs the same parts differently', () => {
    const gallery = createHmacStatementSigner({
      rootSecret: SECRET,
      label: 'eventslide/gallery/v1',
    })

    expect(gallery.sign(STATEMENT)).not.toBe(signer.sign(STATEMENT))
    expect(signer.verify(STATEMENT, gallery.sign(STATEMENT))).toBe(false)
  })

  it('length-prefixes the parts, so no boundary can be moved', () => {
    expect(signer.sign(['ab', 'c'])).not.toBe(signer.sign(['a', 'bc']))
    expect(signer.verify(['a', 'bc'], signer.sign(['ab', 'c']))).toBe(false)
  })

  it('refuses, without throwing, a signature that is not the shape of a MAC', () => {
    const good = signer.sign(STATEMENT)
    const twoByteTail = `${good.slice(0, 42)}${String.fromCharCode(0xe9)}`

    for (const bad of ['', good.slice(1), `${good}A`, twoByteTail, `${good.slice(0, 42)}=`]) {
      expect(signer.verify(STATEMENT, bad)).toBe(false)
    }
  })
})
