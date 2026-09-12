import { createContext } from 'react'
import type { ToastAction, ToastTone } from './Toast'

export interface ToastOptions {
  readonly tone?: ToastTone
  /** `0` pins the toast until it is dismissed by hand. */
  readonly durationMs?: number
  readonly action?: ToastAction
}

export interface ToastApi {
  /** Returns the toast's id, so a caller can retract its own message early. */
  show(message: string, options?: ToastOptions): string
  dismiss(id: string): void
}

/**
 * The toast queue, injected.
 *
 * The context and its contract live in their own module so that `ToastProvider.tsx`
 * exports a component and nothing else, which is what keeps Fast Refresh working for
 * that file.
 */
export const ToastContext = createContext<ToastApi | null>(null)
