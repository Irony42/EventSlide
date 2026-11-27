import type { Transport } from '../../http'
import type { Locale } from '../../i18n/locale'
import type { SignupAnswerDto, SignupConfirmedDto, SignupPreviewDto } from '../dto'
import { encode } from './shared'

/** What the signup form sends (`POST /api/signup`). */
export interface SignupInput {
  readonly email: string
  readonly clientName: string
  readonly note?: string
  /** `YYYY-MM-DD`. */
  readonly eventDate?: string
  /** The language of the page, which is the language of the mails. */
  readonly locale: Locale
  /** The honeypot: always `''` from a person, since nobody can see the box. */
  readonly website: string
}

// Self-service signup (spec 31). Every route answers `404 feature.unavailable` while `SIGNUP=off`.
export const signupApi = (transport: Transport) => ({
  /** `202 {status}`: `sent` whatever the address, `busy` only when the day's cap is reached. */
  requestSignup: (input: SignupInput): Promise<SignupAnswerDto> =>
    transport.post('/api/signup', input),

  /** What the mailed link is, spending nothing: an antivirus may open it before the person does. */
  signupPreview: (token: string, signal?: AbortSignal): Promise<SignupPreviewDto> =>
    transport.get(`/api/signup/confirm/${encode(token)}`, undefined, signal),

  /** Spends the link and confirms the address. Only the person pressing the button gets here. */
  confirmSignup: (token: string): Promise<SignupConfirmedDto> =>
    transport.post(`/api/signup/confirm/${encode(token)}`),
})
