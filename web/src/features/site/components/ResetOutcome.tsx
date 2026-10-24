import { useCallback, useState } from 'react'
import { useApi } from '../../../app/useApi'
import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { useToast } from '../../../design-system/components/useToast'
import type { OperatorPasswordResetDto } from '../../../lib/api/dto'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import { useOperatorAction } from '../hooks/useOperatorAction'
import { LinkNotice } from './LinkNotice'

export interface ResetOutcomeProps {
  readonly userId: string
  /** What the operator asked for first: a reset that is waiting on an owner, or a link. */
  readonly reset: Exclude<OperatorPasswordResetDto, { readonly delivery: 'mail' }>
  readonly onDismiss: () => void
}

/**
 * What a password reset that did **not** go out by mail came to.
 *
 * Where a mailer delivers, the link went to the account's own address and nowhere else, and the
 * server's answer holds none: that case is a toast and never reaches this component. The two that
 * do are the box with no relay and `OPERATOR_RESET_LINKS=copyLinkWithOwnerApproval` (the operator
 * guard's R2):
 *
 * - **Waiting**: another owner of the account's client has to approve the request first. The
 *   operator is told so, and asks again with the approval's id (an id, never a secret) once told it
 *   is done; until then the server answers `reset.requestNotFound` and says so.
 * - **A link**: the one this route ever returns, spent once, held in a box the operator closes once
 *   it has been passed on.
 */
export function ResetOutcome({ userId, reset, onDismiss }: ResetOutcomeProps) {
  const t = useTranslations()
  const { locale } = useLocale()
  const api = useApi()
  const toast = useToast()
  const [current, setCurrent] = useState(reset)
  const fetchApproved = useOperatorAction(
    useCallback(
      (id: string, approvalId: string, language: typeof locale) =>
        api.siteResetPassword(id, { locale: language, approvalId }),
      [api],
    ),
  )

  if (current.delivery === 'link') {
    return (
      <LinkNotice
        title={t.site.resetLinkTitle}
        body={t.site.resetLinkBody}
        label={t.site.invitationLinkLabel}
        link={current.link}
        onDismiss={onDismiss}
      />
    )
  }

  if (current.delivery === 'pendingApproval') {
    const { approvalId } = current
    return (
      <Card
        as="h3"
        title={t.site.resetPending}
        footer={
          <Button
            variant="primary"
            size="sm"
            loading={fetchApproved.busy}
            onClick={() => {
              void fetchApproved.run('fetch', userId, approvalId, locale).then((result) => {
                if (!result.ok) {
                  if (result.message !== null) toast.show(result.message, { tone: 'danger' })
                  return
                }
                if (result.value.delivery === 'mail') {
                  toast.show(t.site.resetSent, { tone: 'success' })
                  onDismiss()
                  return
                }
                setCurrent(result.value)
              })
            }}
          >
            {t.site.resetFetch}
          </Button>
        }
      >
        <p>{t.site.resetPendingBody}</p>
      </Card>
    )
  }

  return null
}
