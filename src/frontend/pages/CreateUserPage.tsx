import { useState } from 'react'
import { createUser } from '../api/auth'
import BackToAdminLink from '../components/BackToAdminLink'
import CreateUserForm from '../components/CreateUserForm'
import PageCard from '../components/PageCard'
import StatusMessage from '../components/StatusMessage'
import { useQueryParam } from '../hooks/useQueryParam'
import AppShell from '../layouts/AppShell'

export default function CreateUserPage() {
  const userCreationFailed = useQueryParam('userCreationFailed')
  const [status, setStatus] = useState<{ type: 'error' | 'success'; message: string } | null>(null)

  const handleSubmit = async (username: string, password: string) => {
    try {
      await createUser(username, password)
      setStatus({ type: 'success', message: 'Utilisateur cree.' })
    } catch {
      setStatus({ type: 'error', message: "La creation de l'utilisateur a echoue." })
    }
  }

  return (
    <AppShell>
      <PageCard title="Creer un nouvel utilisateur">
        <CreateUserForm onSubmit={handleSubmit} />
        <div className="mt-3 d-grid">
          <BackToAdminLink />
        </div>
        {status ? <StatusMessage type={status.type} message={status.message} /> : null}
        {!status && userCreationFailed === 'true' ? (
          <StatusMessage type="error" message="La creation de l'utilisateur a echoue." />
        ) : null}
        {!status && userCreationFailed === 'false' ? (
          <StatusMessage type="success" message="Utilisateur cree." />
        ) : null}
      </PageCard>
    </AppShell>
  )
}
