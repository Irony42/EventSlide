import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../api/auth'
import LoginForm from '../components/LoginForm'
import PageCard from '../components/PageCard'
import StatusMessage from '../components/StatusMessage'
import { useQueryParam } from '../hooks/useQueryParam'
import AppShell from '../layouts/AppShell'

export default function LoginPage() {
  const navigate = useNavigate()
  const authenticationFailed = useQueryParam('authenticationfailed')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (username: string, password: string) => {
    try {
      await login(username, password)
      navigate('/admin')
    } catch {
      setError("L'authentification a echoue. Verifiez vos identifiants.")
    }
  }

  return (
    <AppShell>
      <PageCard title="Authentification">
        <LoginForm onSubmit={handleSubmit} />
        {(authenticationFailed === 'true' || error) && (
          <StatusMessage
            type="error"
            message={error ?? "L'authentification a echoue. Veuillez verifier vos identifiants."}
          />
        )}
      </PageCard>
    </AppShell>
  )
}
