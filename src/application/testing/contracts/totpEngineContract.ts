import { describe, expect, it } from 'vitest'
import type { TotpEngine } from '../../ports/totpEngine'

/**
 * The shared `TotpEngine` contract, run against the in-memory fake and the HMAC-SHA1 adapter.
 *
 * Only what a use case relies on, and nothing about HMAC: the real adapter's arithmetic is held
 * to the RFC vectors in `nodeTotpEngine.test.ts`. What must hold of both is that a code is a
 * function of the secret and the step and of nothing else, that it is always six digits, and
 * that neighbouring steps and different secrets give different codes — the properties under
 * which "a code for the wrong step is refused" and "a code for another account is refused" are
 * statements a test can make.
 */

const SECRET = new TextEncoder().encode('12345678901234567890')
const OTHER_SECRET = new TextEncoder().encode('09876543210987654321')

export const totpEngineContract = (name: string, engine: TotpEngine): void => {
  describe(`TotpEngine contract: ${name}`, () => {
    it('is deterministic: one secret and one step always give one code', () => {
      expect(engine.codeAt(SECRET, 1000)).toBe(engine.codeAt(SECRET, 1000))
    })

    it('answers exactly six digits, leading zeros kept', () => {
      for (let step = 0; step < 200; step += 1) {
        expect(engine.codeAt(SECRET, step)).toMatch(/^\d{6}$/)
      }
    })

    it('gives the steps either side of one a code of their own', () => {
      const codes = new Set([999, 1000, 1001].map((step) => engine.codeAt(SECRET, step)))

      expect(codes.size).toBe(3)
    })

    it('gives another secret another code', () => {
      expect(engine.codeAt(OTHER_SECRET, 1000)).not.toBe(engine.codeAt(SECRET, 1000))
    })

    it('does not change the secret it is given', () => {
      const secret = Uint8Array.from(SECRET)
      engine.codeAt(secret, 5)

      expect(secret).toEqual(SECRET)
    })
  })
}
