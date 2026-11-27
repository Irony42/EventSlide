import { useCallback, useState } from 'react'
import { useApi } from '../../../lib/useApi'
import { Button } from '../../../design-system/components/Button'
import { CheckboxField } from '../../../design-system/components/CheckboxField'
import { Dialog } from '../../../design-system/components/Dialog'
import type { SiteSignupDto } from '../../../lib/api/dto'
import { useTranslations } from '../../../lib/i18n/useTranslations'
import { useOperatorAction } from '../hooks/useOperatorAction'

export interface RefuseSignupDialogProps {
  readonly signup: SiteSignupDto
  readonly onRefused: () => void
  readonly onCancel: () => void
  /** The write was refused: the list behind the dialog may be out of date. */
  readonly onFailed: () => void
}

/**
 * Refuses one held request (`POST /api/site/signups/:id/refuse`, behind the console's step-up).
 * No reason is asked and none is kept; « Prévenir la personne » is checked by default and sends
 * a neutral mail when it stays checked.
 */
export function RefuseSignupDialog({
  signup,
  onRefused,
  onCancel,
  onFailed,
}: RefuseSignupDialogProps) {
  const t = useTranslations()
  const api = useApi()
  const [notify, setNotify] = useState(true)
  const [failure, setFailure] = useState<string | null>(null)
  const refuse = useOperatorAction(
    useCallback((id: string, tell: boolean) => api.siteRefuseSignup(id, tell), [api]),
  )

  const confirm = () => {
    setFailure(null)
    void refuse.run(signup.id, signup.id, notify).then((result) => {
      if (!result.ok) {
        setFailure(result.message)
        if (result.message !== null) onFailed()
        return
      }
      onRefused()
    })
  }

  return (
    <Dialog
      open
      title={t.siteSignups.refuseTitle(signup.clientName)}
      description={t.siteSignups.refuseBody}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={refuse.busy}>
            {t.app.cancel}
          </Button>
          <Button variant="danger" loading={refuse.busy} onClick={confirm}>
            {t.siteSignups.refuseConfirm}
          </Button>
        </>
      }
    >
      <CheckboxField
        label={t.siteSignups.notify}
        hint={t.siteSignups.notifyHint}
        checked={notify}
        onChange={setNotify}
      />
      {failure === null ? null : <p role="alert">{failure}</p>}
    </Dialog>
  )
}
