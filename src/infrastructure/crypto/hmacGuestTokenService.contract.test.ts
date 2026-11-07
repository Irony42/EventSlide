import { guestTokenServiceContract } from '../../application/testing/contracts/guestTokenServiceContract'
import { createHmacGuestTokenService } from './hmacGuestTokenService'

guestTokenServiceContract('hmac', () =>
  createHmacGuestTokenService({ secret: 'a-secret-of-at-least-thirty-two-characters!' }),
)
