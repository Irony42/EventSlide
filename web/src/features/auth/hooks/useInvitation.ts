import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../../../app/useApi'
import type { InvitationAcceptance } from '../../../lib/api/client'
import type { InvitationAcceptedDto, InvitationPreviewDto } from '../../../lib/api/dto'
import { ApiError } from '../../../lib/http'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { errorMessage } from '../errorMessage'

/**
 * What an invitation link is, as the reader's page needs it (G2-09 / P3-10, G2-10 / P3-11).
 *
 * Both hooks exist so the page never touches the transport, and so the one decision that is
 * not a sentence — "is this link dead?" — is made in one place.
 */

/**
 * The two codes that mean "this link opens nothing", and the page says one thing for both.
 *
 * `invitation.notFound` is every unknown, malformed, spent, replaced or expired link, byte for
 * byte (the server's own rule: a refusal never says which). `event.immutable` is the same
 * outcome for a link to an event that has since been archived: it can never be accepted, and
 * to the person holding it that is a dead link. Showing it as another sentence would be a
 * second answer where the server took care to give one.
 */
const DEAD_LINK = new Set(['invitation.notFound', 'event.immutable'])

const isDeadLink = (cause: unknown): boolean =>
  cause instanceof ApiError && DEAD_LINK.has(cause.code)

export type InvitationView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly preview: InvitationPreviewDto }
  /** Dead, whatever killed it. */
  | { readonly kind: 'dead' }
  /** Could not be asked, which is not the same as dead: the link may be perfectly good. */
  | { readonly kind: 'failed'; readonly message: string }

export interface InvitationPreviewState {
  readonly view: InvitationView
  /** Asks again. Offered only after a failure to ask. */
  readonly reload: () => void
}

/**
 * Reads what the link offers. Spends nothing: a mail client that opens links to preview them
 * cannot use one up, and neither can this.
 *
 * A dropped connection is `failed` with a retry, never `dead`: telling somebody on a venue's
 * Wi-Fi that their invitation is no longer valid because the network blinked would send them
 * to ask for a new one they do not need.
 */
export const useInvitationPreview = (token: string): InvitationPreviewState => {
  const api = useApi()
  const t = useTranslations()
  // The token the answer is for travels with it, so a navigation from one link to another
  // shows the wait again instead of the previous link's invitation for a moment.
  const [answer, setAnswer] = useState<{
    readonly token: string
    readonly view: InvitationView
  } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    api.invitation(token, controller.signal).then(
      (preview) => {
        if (!controller.signal.aborted) setAnswer({ token, view: { kind: 'ready', preview } })
      },
      (cause: unknown) => {
        // The abort is this effect's own cleanup (StrictMode mounts twice), not a failure.
        if (controller.signal.aborted) return
        setAnswer({
          token,
          view: isDeadLink(cause)
            ? { kind: 'dead' }
            : { kind: 'failed', message: errorMessage(cause, t) },
        })
      },
    )

    return () => controller.abort()
  }, [api, t, token, attempt])

  const reload = useCallback(() => {
    setAnswer(null)
    setAttempt((current) => current + 1)
  }, [])

  const view: InvitationView =
    answer !== null && answer.token === token ? answer.view : { kind: 'loading' }

  return { view, reload }
}

/** What accepting came to. */
export type AcceptOutcome =
  | { readonly kind: 'accepted'; readonly accepted: InvitationAcceptedDto }
  /** The link died between the preview and the press: spent by the person it was for, replaced. */
  | { readonly kind: 'dead' }
  /** The address has an account: nothing was created, the link is not spent. */
  | { readonly kind: 'signInRequired' }
  /** Anything else, as a sentence. `code` is what the page keys a remedy on. */
  | { readonly kind: 'refused'; readonly code: string; readonly message: string }

export interface AcceptInvitationState {
  readonly submit: (acceptance: InvitationAcceptance) => Promise<AcceptOutcome>
  readonly submitting: boolean
}

export const useAcceptInvitation = (token: string): AcceptInvitationState => {
  const api = useApi()
  const t = useTranslations()
  const [submitting, setSubmitting] = useState(false)

  const submit = useCallback(
    async (acceptance: InvitationAcceptance): Promise<AcceptOutcome> => {
      setSubmitting(true)
      try {
        return { kind: 'accepted', accepted: await api.acceptInvitation(token, acceptance) }
      } catch (cause) {
        if (isDeadLink(cause)) return { kind: 'dead' }
        if (cause instanceof ApiError && cause.code === 'invitation.signInRequired') {
          return { kind: 'signInRequired' }
        }
        return {
          kind: 'refused',
          code: cause instanceof ApiError ? cause.code : 'unknown',
          message: errorMessage(cause, t),
        }
      } finally {
        setSubmitting(false)
      }
    },
    [api, t, token],
  )

  return { submit, submitting }
}
