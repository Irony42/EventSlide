import { mfaVaultContract } from '../../application/testing/contracts/mfaVaultContract'
import { createAesGcmMfaVault } from './aesGcmMfaVault'

mfaVaultContract('aes-256-gcm', () => ({
  vault: createAesGcmMfaVault({ keyMaterial: new Uint8Array(32).fill(1) }),
  stranger: createAesGcmMfaVault({ keyMaterial: new Uint8Array(32).fill(2) }),
}))
