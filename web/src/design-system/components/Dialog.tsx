import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from 'react'
import { CloseIcon } from './CloseIcon'
import { IconButton } from './IconButton'
import { fr } from '../../lib/i18n/fr'
import styles from './Dialog.module.css'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * A ref whose `current` is only read.
 *
 * Declared structurally with a `readonly` member instead of `RefObject<HTMLElement>`:
 * `RefObject` is mutable and therefore invariant, so a `useRef<HTMLButtonElement>`
 * would not be assignable to it and the caller would need a cast.
 */
export interface ReadableRef {
  readonly current: HTMLElement | null
}

export interface DialogProps {
  readonly open: boolean
  readonly title: string
  readonly description?: string
  readonly onClose: () => void
  /**
   * Whether a backdrop click and the close button dismiss the dialog. `false` for a
   * dialog that must be answered. Escape always closes: it is the one gesture a user
   * expects to work everywhere, and trapping someone in a modal is worse than a
   * decision they can retake.
   */
  readonly dismissible?: boolean
  /** Where focus lands on open. Defaults to the first focusable element. */
  readonly initialFocusRef?: ReadableRef
  readonly footer?: ReactNode
  readonly children?: ReactNode
  readonly className?: string
}

/**
 * A modal, on the native `<dialog>`.
 *
 * Native `showModal()` brings the focus trap, the `::backdrop` pseudo-element and the
 * top-layer stacking for free in a browser. It replaces every `window.confirm` in 1.0,
 * which could not be styled, could not be tested, and is silently blocked in some
 * in-app browsers — including the ones guests reach the app through when they scan a
 * QR code from a messaging app.
 *
 * `open` is a prop, so React state stays the single source of truth: the native
 * Escape gesture is intercepted rather than allowed to close the element behind
 * React's back, which would leave the DOM and the state disagreeing.
 */
export function Dialog({
  open,
  title,
  description,
  onClose,
  dismissible = true,
  initialFocusRef,
  footer,
  children,
  className,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const openerRef = useRef<Element | null>(null)
  const generated = useId()
  const titleId = `${generated}-title`
  const descriptionId = `${generated}-description`

  useEffect(() => {
    const element = dialogRef.current
    if (element === null) return

    if (open) {
      if (!element.open) {
        // Captured before the modal steals focus, so it can be handed back on close.
        openerRef.current = document.activeElement
        element.showModal()
      }
      const target =
        initialFocusRef?.current ?? element.querySelector<HTMLElement>(FOCUSABLE) ?? element
      target.focus()
      return
    }

    if (element.open) element.close()

    // Returning focus is what keeps the keyboard journey unbroken: without it the next
    // Tab starts from the top of the document, which on the moderation console means
    // scrolling back down to the tile the host was working on.
    const opener = openerRef.current
    openerRef.current = null
    if (opener instanceof HTMLElement) opener.focus()
  }, [open, initialFocusRef])

  useEffect(() => {
    const element = dialogRef.current
    if (element === null || !open) return

    const handleCancel = (event: Event) => {
      event.preventDefault()
      onClose()
    }

    const handleNativeClose = () => {
      // A `<form method="dialog">` inside the body, or a browser gesture: sync React
      // rather than leaving the element closed while the prop still says open.
      // The listener only exists while `open` is true — the effect returns early
      // otherwise and removes it on teardown — so no staleness guard is needed. The
      // ref that used to hold the latest `open` was written during render, which is
      // unsafe under concurrent rendering: a discarded render still mutated it.
      onClose()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      // The native modal already traps focus in a browser. This keeps the trap real
      // under jsdom, where the top layer does not exist, so the behaviour is actually
      // asserted by a test rather than assumed.
      const focusable = Array.from(element.querySelectorAll<HTMLElement>(FOCUSABLE))
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (first === undefined || last === undefined) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    element.addEventListener('cancel', handleCancel)
    element.addEventListener('close', handleNativeClose)
    element.addEventListener('keydown', handleKeyDown)
    return () => {
      element.removeEventListener('cancel', handleCancel)
      element.removeEventListener('close', handleNativeClose)
      element.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  const handleClick = (event: MouseEvent<HTMLDialogElement>) => {
    // The panel is a child, so a click whose target is the dialog itself landed on the
    // backdrop. Guarded by `dismissible`: losing a half-typed caption to a stray tap
    // beside the panel is exactly the kind of loss the guest surface must not cause.
    if (!dismissible) return
    if (event.target === dialogRef.current) onClose()
  }

  const classes = [styles['dialog'], className].filter(Boolean).join(' ')

  return (
    <dialog
      ref={dialogRef}
      className={classes}
      aria-labelledby={titleId}
      {...(description === undefined ? {} : { 'aria-describedby': descriptionId })}
      onClick={handleClick}
    >
      {/*
        The contents exist only while the dialog is open: a closed dialog that still
        holds a form keeps its half-filled state, its mounted image requests and its
        focusable children, and jsdom has no top layer to hide them behind.
      */}
      {open ? (
        <div className={styles['panel']}>
          <div className={styles['header']}>
            <h2 className={styles['title']} id={titleId}>
              {title}
            </h2>
            {dismissible ? (
              <IconButton
                aria-label={fr.ui.dialogClose}
                icon={<CloseIcon />}
                variant="ghost"
                onClick={onClose}
              />
            ) : null}
          </div>
          {description === undefined ? null : (
            <p className={styles['description']} id={descriptionId}>
              {description}
            </p>
          )}
          {children === undefined ? null : <div className={styles['body']}>{children}</div>}
          {footer === undefined ? null : <div className={styles['footer']}>{footer}</div>}
        </div>
      ) : null}
    </dialog>
  )
}
