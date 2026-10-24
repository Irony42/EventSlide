import { Card } from '../../../design-system/components/Card'
import type { SiteInvitationDto } from '../../../lib/api/dto'
import { formatDateTime } from '../../../lib/format'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { LinkNotice } from './LinkNotice'

export interface InvitationOutcomeProps {
  readonly invitation: SiteInvitationDto
  /** The address the operator typed: printed back, never read from the answer, which holds none. */
  readonly email: string
  readonly onDismiss: () => void
}

/**
 * What became of an invitation, in the three ways the server can say it.
 *
 * - **By mail** (`delivery: 'mail'`): the link is in the person's inbox and nowhere else, and the
 *   answer holds none, so there is nothing to show but where it went and until when.
 * - **By link** (`delivery: 'link'`): no mail went out, so this is the only copy, held in a box the
 *   operator closes once it has been passed on.
 * - **Waiting** (`pendingApproval`): written and mailed like any other, but it opens nothing until
 *   an owner of the client agrees (the operator guard's R1), and the operator is told so rather
 *   than left to wonder why nobody can sign in.
 */
export function InvitationOutcome({ invitation, email, onDismiss }: InvitationOutcomeProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  const until = formatDateTime(invitation.expiresAt, locale) ?? invitation.expiresAt

  return (
    <>
      {invitation.delivery === 'link' && invitation.link !== undefined ? (
        <LinkNotice
          title={t.site.invitationLinkTitle}
          body={t.site.invitationLinkBody}
          label={t.site.invitationLinkLabel}
          link={invitation.link}
          onDismiss={onDismiss}
        />
      ) : (
        <Card as="h3" title={t.site.invitationMailed(email)} role="status">
          <p>{t.site.invitationValidUntil(until)}</p>
        </Card>
      )}
      {invitation.pendingApproval ? <p role="status">{t.site.invitationPending}</p> : null}
    </>
  )
}
