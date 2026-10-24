import { Button } from '../../../design-system/components/Button'
import { Card } from '../../../design-system/components/Card'
import { useToast } from '../../../design-system/components/useToast'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import styles from './LinkNotice.module.css'

export interface LinkNoticeProps {
  readonly title: string
  readonly body: string
  readonly label: string
  /** The address that exists nowhere else: an invitation's, or a reset's. */
  readonly link: string
  readonly onDismiss: () => void
}

/**
 * A link the server handed back **because no mail carried it**, held on screen until the operator
 * has passed it on.
 *
 * Where a mailer delivers, the server's answer holds no link and no token (docs/API.md §1), so
 * this is the exception and not the way: a box with no relay, a relay that refused, a reset that
 * an owner approved. The link is state of this component's parent and nothing else: not in the
 * address bar, not in storage, not logged, and gone when the operator closes the box or leaves the
 * page. It is shown as text, never opened by the console, so the operator is never one click from
 * spending a person's one-time link.
 */
export function LinkNotice({ title, body, label, link, onDismiss }: LinkNoticeProps) {
  const t = useTranslations()
  const toast = useToast()

  const copy = () => {
    // Some browsers ship no clipboard in an insecure context; a guard is cheaper than a click that
    // throws, and the link is on screen to be selected either way.
    if (typeof navigator.clipboard?.writeText !== 'function') return
    void navigator.clipboard
      .writeText(link)
      .then(() => toast.show(t.site.linkCopied, { tone: 'success' }))
  }

  return (
    <Card as="h3" title={title} footer={<LinkActions onCopy={copy} onDismiss={onDismiss} />}>
      <p>{body}</p>
      <p className={styles['label']}>{label}</p>
      <code className={styles['link']}>{link}</code>
    </Card>
  )
}

function LinkActions({
  onCopy,
  onDismiss,
}: {
  readonly onCopy: () => void
  readonly onDismiss: () => void
}) {
  const t = useTranslations()
  return (
    <div className={styles['actions']}>
      <Button variant="primary" size="sm" onClick={onCopy}>
        {t.site.copyLink}
      </Button>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        {t.app.close}
      </Button>
    </div>
  )
}
