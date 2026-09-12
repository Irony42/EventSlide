import { useContext } from 'react'
import type { Api } from '../lib/api/client'
import { ApiContext } from './apiContext'

export function useApi(): Api {
  const api = useContext(ApiContext)
  if (api === null) {
    throw new Error(
      'useApi must be used inside an <ApiProvider>. Wrap the tree in main.tsx, or use renderWithProviders in a test.',
    )
  }
  return api
}
