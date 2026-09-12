import { useContext } from 'react'
import { ToastContext, type ToastApi } from './toastContext'

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (api === null) {
    throw new Error('useToast must be used inside a <ToastProvider>. Mount one at the app root.')
  }
  return api
}
