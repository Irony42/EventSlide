import type { Transport } from '../../http'
import type { Locale } from '../../i18n/locale'
import type {
  InvitationAcceptedDto,
  InvitationPreviewDto,
  RecoveryCodesDto,
  SecondFactorProof,
  SecondFactorRequiredDto,
  SessionResponse,
  SessionUserDto,
  TotpEnrolmentDto,
} from '../dto'
import { encode } from './shared'

/** The two halves of a second-factor proof, as the wire names them: one is always absent. */
const codeOf = (proof: SecondFactorProof | undefined): string | undefined =>
  proof !== undefined && 'code' in proof ? proof.code : undefined
const recoveryCodeOf = (proof: SecondFactorProof | undefined): string | undefined =>
  proof !== undefined && 'recoveryCode' in proof ? proof.recoveryCode : undefined

// Sign-in, second factor, the signed-in account and the invitations it answers.
/**
 * What accepting an invitation sends (`POST /api/invitations/:token/accept`): a person
 * choosing how to sign in, or — from a session the link is for — nothing at all.
 *
 * Two shapes and no third. The server's body is `.strict()`, so a field that could name an
 * account (an address, an id) is a 400: the account an acceptance attaches is the one in the
 * session, never one the request names.
 *
 * Either may carry `acceptTerms`, the tick of "I accept the terms of use" (G2-20), and **only
 * when the preview said the box asks for terms**: on any other box the key is not sent, so a
 * self-hosted server sees the body it always did. It is a boolean and never a version: the
 * version recorded is the box's own.
 */
export type InvitationAcceptance =
  | {
      readonly kind: 'newAccount'
      readonly displayName: string
      readonly password: string
      readonly acceptTerms?: boolean
    }
  | { readonly kind: 'signedInAccount'; readonly acceptTerms?: boolean }
export const accountApi = (transport: Transport) => ({
  /** A session, or — for an account with an authenticator — the request for its second step. */
  login: (email: string, password: string): Promise<SessionUserDto | SecondFactorRequiredDto> =>
    transport.post('/api/auth/login', { email, password }),

  /** The second step of a sign-in: a code from the app, or one recovery code. */
  loginSecondFactor: (proof: SecondFactorProof): Promise<SessionUserDto> =>
    transport.post('/api/auth/login/2fa', {
      code: codeOf(proof),
      recoveryCode: recoveryCodeOf(proof),
    }),

  /** Starts an enrolment. The password again: a cookie alone must not attach a phone. */
  enrollSecondFactor: (password: string): Promise<TotpEnrolmentDto> =>
    transport.post('/api/auth/2fa/enroll', { password }),

  /** Proves the app shows the right code; answers the recovery codes, once. */
  confirmSecondFactor: (code: string): Promise<RecoveryCodesDto> =>
    transport.post('/api/auth/2fa/confirm', { code }),

  /** Confirms the person at the keyboard for five minutes: password, and a code if enrolled. */
  stepUp: (password: string, proof?: SecondFactorProof): Promise<void> =>
    transport.post('/api/auth/step-up', {
      password,
      code: codeOf(proof),
      recoveryCode: recoveryCodeOf(proof),
    }),

  /** Needs a fresh step-up. Replaces every recovery code. */
  regenerateRecoveryCodes: (): Promise<RecoveryCodesDto> =>
    transport.post('/api/auth/2fa/recovery-codes'),

  /** Needs a fresh step-up. Removes the authenticator and its recovery codes. */
  disableSecondFactor: (): Promise<void> => transport.post('/api/auth/2fa/disable'),

  logout: (): Promise<void> => transport.post('/api/auth/logout'),

  session: (signal?: AbortSignal): Promise<SessionResponse> =>
    transport.get('/api/auth/me', undefined, signal),

  /** Erases the signed-in account, behind its password (and the authenticator's `code` when it has one). Only where `SITE_ADMIN=on`; `409 account.holds…` while it owns an event. */
  deleteOwnAccount: (password: string, code?: string): Promise<void> =>
    transport.post('/api/auth/account/delete', { password, code }),

  changePassword: (currentPassword: string, newPassword: string): Promise<void> =>
    transport.post('/api/auth/password', { currentPassword, newPassword }),

  /**
   * "Forgot your password?" (G2-08 / P3-09). `202 {}` for **every** address — an account, a
   * stranger, a malformed one — so the page says the same thing whatever was typed; `404
   * feature.unavailable` only on a box that cannot send mail, whatever the address. The
   * locale is the page's, because it is the language the mail is written in.
   */
  requestPasswordReset: (email: string, locale: Locale): Promise<void> =>
    transport.post('/api/auth/password-reset/request', { email, locale }),

  /**
   * The mailed link's token and the password chosen with it. `204`: the password is set and
   * **every session is signed out**, none started. The token travels in the body, never in a
   * URL the client builds. A refused password does not spend the link (`400 password.*`).
   */
  confirmPasswordReset: (token: string, password: string): Promise<void> =>
    transport.post('/api/auth/password-reset/confirm', { token, password }),

  /**
   * Signs out every other session of this account. The caller's own is replaced and stays
   * in, so "sign out everywhere" is this call and then {@link Api.logout}.
   */
  revokeOtherSessions: (): Promise<void> => transport.post('/api/auth/sessions/revoke-others'),

  /**
   * What the link in front of the reader offers, spending nothing. `404 invitation.notFound`
   * for every dead link alike — unknown, malformed, spent, replaced, expired — and the page
   * says one thing for all of them.
   */
  invitation: (token: string, signal?: AbortSignal): Promise<InvitationPreviewDto> =>
    transport.get(`/api/invitations/${encode(token)}`, undefined, signal),

  /**
   * Accepts it. A new account starts a session in the same answer; a signed-in account
   * sends `{}` and its session is the only thing that names it.
   */
  acceptInvitation: (
    token: string,
    acceptance: InvitationAcceptance,
  ): Promise<InvitationAcceptedDto> =>
    transport.post(`/api/invitations/${encode(token)}/accept`, {
      ...(acceptance.kind === 'newAccount'
        ? { displayName: acceptance.displayName, password: acceptance.password }
        : {}),
      ...(acceptance.acceptTerms === undefined ? {} : { acceptTerms: acceptance.acceptTerms }),
    }),
})
