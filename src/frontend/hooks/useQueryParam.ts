import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'

export const useQueryParam = (name: string): string | null => {
  const location = useLocation()
  return useMemo(() => new URLSearchParams(location.search).get(name), [location.search, name])
}
