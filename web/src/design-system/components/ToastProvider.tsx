import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Toast, type ToastAction, type ToastTone } from './Toast'
import styles from './ToastProvider.module.css'

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

interface ToastRecord {
  readonly id: string
  readonly tone: ToastTone
  readonly message: string
  readonly action?: ToastAction
}

const DEFAULT_DURATION_MS = 4_000

/**
 * How long an undo stays reachable.
 *
 * The moderation console depends on this: a host presses "Refuser", looks up at the
 * projector to check, then looks back. Four seconds is not enough to find the undo
 * again, and a decision that cannot be taken back makes a host stop using the
 * keyboard shortcuts altogether.
 */
const UNDO_DURATION_MS = 9_000

const ToastContext = createContext<ToastApi | null>(null)

export interface ToastProviderProps {
  readonly children: ReactNode
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<readonly ToastRecord[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const lastId = useRef(0)

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback(
    (message: string, options: ToastOptions = {}) => {
      lastId.current += 1
      const id = `toast-${lastId.current}`
      const action = options.action
      const requested =
        options.durationMs ?? (action === undefined ? DEFAULT_DURATION_MS : UNDO_DURATION_MS)
      // An undo that disappears before it can be found is worse than no undo at all:
      // the host believes the action is reversible and it is not.
      const duration = action === undefined ? requested : Math.max(requested, UNDO_DURATION_MS)

      setToasts((current) => [
        ...current,
        {
          id,
          tone: options.tone ?? 'neutral',
          message,
          ...(action === undefined ? {} : { action }),
        },
      ])

      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        )
      }

      return id
    },
    [dismiss],
  )

  // Navigating away from the moderation console with an undo toast still counting down
  // would otherwise leave a timer holding a setState on an unmounted provider.
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss])

  const isFailure = (toast: ToastRecord) => toast.tone === 'danger' || toast.tone === 'warning'
  const failures = toasts.filter(isFailure)
  const notices = toasts.filter((toast) => !isFailure(toast))

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles['region']}>
        {/*
          The failures container is mounted only when it has something in it, and
          carries role="alert" — inserting a role="alert" node is announced by every
          current screen reader, and an always-present empty alert would make
          `getByRole('alert')` ambiguous in every feature test that renders the app.
        */}
        {failures.length === 0 ? null : (
          <div className={styles['stack']} role="alert">
            {failures.map((toast) => (
              <Toast
                key={toast.id}
                tone={toast.tone}
                message={toast.message}
                {...(toast.action === undefined ? {} : { action: toast.action })}
                onDismiss={() => dismiss(toast.id)}
              />
            ))}
          </div>
        )}
        {/*
          The polite container stays mounted: a live region has to exist before its
          content changes, or the first announcement is swallowed.
        */}
        <div className={styles['stack']} aria-live="polite" aria-relevant="additions text">
          {notices.map((toast) => (
            <Toast
              key={toast.id}
              tone={toast.tone}
              message={toast.message}
              {...(toast.action === undefined ? {} : { action: toast.action })}
              onDismiss={() => dismiss(toast.id)}
            />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (api === null) {
    throw new Error('useToast must be used inside a <ToastProvider>. Mount one at the app root.')
  }
  return api
}
