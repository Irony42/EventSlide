// Sign-in, second factor and the session.

/**
 * What a link offers, as `GET /api/invitations/:token` answers it (G2-09 / P3-10): the kind
 * of thing it opens, the role, the name of the event or client, and when it ends. Nothing
 * about who invited, nor about the address — and so nothing about whether it has an account.
 * `targetName` is content (an event's or a client's name): printed as written, never translated.
 */
export interface InvitationPreviewDto {
  readonly kind: 'event' | 'client'
  readonly role: 'moderator' | 'owner' | 'member'
  readonly targetName: string
  readonly expiresAt: string
  /**
   * The terms accepting agrees to (G2-20): present **only on a box that asks for them**, where
   * the page shows a required, unticked box beside a link to `url`. Absent on every
   * self-hosted box, which is the page as it was.
   */
  readonly terms?: { readonly url: string; readonly version: string }
}
/**
 * What accepting answers (`POST /api/invitations/:token/accept`). `eventSlug` is `null` for a
 * client: there is no event to open yet. No address and no account id, by design.
 */
export interface InvitationAcceptedDto {
  readonly status: 'accepted'
  readonly kind: 'event' | 'client'
  readonly role: 'moderator' | 'owner' | 'member'
  readonly targetName: string
  readonly eventSlug: string | null
}
/** The console's guided tours (`domain/users/guidedTour.ts`): `POST /api/auth/tours/:tour`. */
export type GuidedTour = 'eventPage'

export interface SessionUserDto {
  readonly userId: string
  readonly email: string
  readonly displayName: string | null
  readonly mustChangePassword: boolean
}
/**
 * Who `GET /api/auth/me` says is signed in. `canOperateSite` is the account's authority
 * over the box, read from storage on that request; it is **not** whether the operator's
 * console exists here, which is `features.siteAdmin` on `GET /api/about`. The console entry
 * the account menu will offer (G2-15) needs both to be true. Nothing reads this field yet;
 * the login answers with `SessionUserDto` alone.
 */
export interface CurrentUserDto extends SessionUserDto {
  readonly canOperateSite: boolean
  /** Where the account stands with the second factor (G2-13 / P3-15). */
  readonly secondFactor: SecondFactorStatusDto
  /**
   * The console's guided tours this account was already shown or skipped (`'eventPage'`), on
   * any device: such a tour is not offered by itself again. Grants nothing.
   */
  readonly toursSeen: readonly string[]
}
/**
 * What decides between "carry on", "enrol" and "enter your code". `available`: this box has a
 * key, so an operator can enrol. `enrolled`: the account has a confirmed authenticator.
 * `verified`: **this session** has passed the second factor. `required`: this account must
 * have, before the operator's namespace answers.
 */
export interface SecondFactorStatusDto {
  readonly available: boolean
  readonly enrolled: boolean
  readonly verified: boolean
  readonly required: boolean
}
/**
 * `POST /api/auth/login` for an account with an authenticator: the password was right and no
 * session was started. The caller asks for a code and sends it to `POST /api/auth/login/2fa`.
 */
export interface SecondFactorRequiredDto {
  readonly secondFactorRequired: true
}
/** What a person typed for a second factor: a code from the app, or one recovery code. */
export type SecondFactorProof = { readonly code: string } | { readonly recoveryCode: string }
/** The secret of an enrolment, once. The URI carries it too: both are the secret. */
export interface TotpEnrolmentDto {
  readonly otpauthUri: string
  readonly secret: string
}
/** Recovery codes, shown once as `K7QM-2XTR-9PHD-4VNB`. */
export interface RecoveryCodesDto {
  readonly recoveryCodes: readonly string[]
}
export type SessionResponse =
  | { readonly authenticated: true; readonly user: CurrentUserDto }
  | { readonly authenticated: false }
