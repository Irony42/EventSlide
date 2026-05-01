import { PropsWithChildren, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { getSession } from '../api/auth'

export default function AuthGuard({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)

  useEffect(() => {
    getSession()
      .then((session) => setAuthenticated(session.authenticated))
      .catch(() => setAuthenticated(false))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="container py-4 text-light">Chargement...</div>
  if (!authenticated) return <Navigate to="/login?authenticationfailed=true" replace />
  return <>{children}</>
}
