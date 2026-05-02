import { useEffect, useState } from 'react'
import { getSession } from '../api/auth'

export const useSession = () => {
  const [session, setSession] = useState<{ authenticated: boolean; user?: { username: string; partyId: string } } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSession()
      .then((data) => setSession(data))
      .catch(() => setSession({ authenticated: false }))
      .finally(() => setLoading(false))
  }, [])

  return { session, loading }
}
