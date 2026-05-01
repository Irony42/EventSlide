import { useState } from 'react'
import { changePassword } from '../api/auth'
import BackToAdminLink from '../components/BackToAdminLink'
import PageCard from '../components/PageCard'
import PasswordChangeForm from '../components/PasswordChangeForm'
import StatusMessage from '../components/StatusMessage'
import { useQueryParam } from '../hooks/useQueryParam'
import AppShell from '../layouts/AppShell'

export default function PasswordChangePage() {
  const passwordChange = useQueryParam('passwordChange')
  const [status, setStatus] = useState<{ type: 'error' | 'success'; message: string } | null>(null)

  const handleSubmit = async (password: string, newPassword: string, newPassword2: string) => {
    try {
      await changePassword(password, newPassword, newPassword2)
      setStatus({ type: 'success', message: 'Mot de passe change.' })
    } catch {
      setStatus({ type: 'error', message: 'Le changement de mot de passe a echoue.' })
    }
  }

  return (
    <AppShell>
      <PageCard title="Changer mon mot de passe">
        <PasswordChangeForm onSubmit={handleSubmit} />
        <div className="mt-3 d-grid">
          <BackToAdminLink />
        </div>
        {status ? <StatusMessage type={status.type} message={status.message} /> : null}
        {!status && passwordChange === 'true' ? (
          <StatusMessage type="error" message="Le changement de mot de passe a echoue." />
        ) : null}
        {!status && passwordChange === 'false' ? (
          <StatusMessage type="success" message="Mot de passe change." />
        ) : null}
      </PageCard>
    </AppShell>
  )
}
