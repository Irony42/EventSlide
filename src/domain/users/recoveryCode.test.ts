import { describe, expect, it } from 'vitest'
import {
  RECOVERY_CODE_BYTES,
  RECOVERY_CODE_COUNT,
  canonicalRecoveryCode,
  formatRecoveryCode,
  recoveryCodeFromBytes,
} from './recoveryCode'

const bytes = (fill: number): Uint8Array => new Uint8Array(RECOVERY_CODE_BYTES).fill(fill)

describe('recoveryCodeFromBytes', () => {
  it('maps eighty bits to sixteen characters of Crockford base32', () => {
    expect(recoveryCodeFromBytes(bytes(0))).toBe('0000000000000000')
    expect(recoveryCodeFromBytes(bytes(255))).toBe('ZZZZZZZZZZZZZZZZ')
    expect(recoveryCodeFromBytes(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBe(
      '041061050R3GG28A',
    )
  })

  it('reads no more than the ten bytes it needs', () => {
    expect(recoveryCodeFromBytes(new Uint8Array(32).fill(255))).toBe('ZZZZZZZZZZZZZZZZ')
  })

  it('hands out ten codes at a time', () => {
    expect(RECOVERY_CODE_COUNT).toBe(10)
  })
})

describe('formatRecoveryCode', () => {
  it('shows four groups of four', () => {
    expect(formatRecoveryCode('K7QM2XTR9PHD4VNB')).toBe('K7QM-2XTR-9PHD-4VNB')
  })
})

describe('canonicalRecoveryCode', () => {
  it('is the identity on a canonical code', () => {
    expect(canonicalRecoveryCode('K7QM2XTR9PHD4VNB')).toBe('K7QM2XTR9PHD4VNB')
  })

  it('folds what a person actually types: case, separators and confusable characters', () => {
    expect(canonicalRecoveryCode('k7qm-2xtr-9phd-4vnb')).toBe('K7QM2XTR9PHD4VNB')
    expect(canonicalRecoveryCode(' K7QM 2XTR.9PHD_4VNB ')).toBe('K7QM2XTR9PHD4VNB')
    expect(canonicalRecoveryCode('O7QM2XTR9PHD4VNL')).toBe('07QM2XTR9PHD4VN1')
    expect(canonicalRecoveryCode('I7QM2XTR9PHD4VNB')).toBe('17QM2XTR9PHD4VNB')
  })

  it.each(['', 'K7QM2XTR9PHD4VN', 'K7QM2XTR9PHD4VNBB', 'K7QM2XTR9PHD4VNU', 'K7QM2XTR9PHD4VN!'])(
    'refuses %j, which cannot be a recovery code',
    (input) => {
      expect(canonicalRecoveryCode(input)).toBeNull()
    },
  )

  it('round-trips a minted code through its displayed form', () => {
    const minted = recoveryCodeFromBytes(Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]))
    expect(canonicalRecoveryCode(formatRecoveryCode(minted))).toBe(minted)
  })
})
