import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '../design-system/components/Button'
import { ConfirmDialog } from '../design-system/components/ConfirmDialog'
import { useToast } from '../design-system/components/useToast'
import { useSignOut } from '../features/auth/hooks/useAuthActions'
import { useTranslations } from '../lib/i18n/useTranslations'
import { useSession } from './useSession'
import styles from './AccountMenu.module.css'

/**
 * The signed-in account's way out, in the header of the host's own screens.
 *
 * Surface: **the host and the moderator**, on a laptop or a phone, on `/admin/**`. 1.0 had no
 * control that signed anybody out — `api.logout` was never called — so a laptop passed to the
 * next person at a venue stayed the host's, and a lost phone was a session nobody could end.
 *
 * Three entries, each with its own reason:
 *
 * - **Sign out**: this browser. Navigates to the sign-in page *after* the server has said the
 *   session is gone, never before: a menu that left while the request failed would show a
 *   signed-out page over a session that is still valid.
 * - **Sign out everywhere**: every device, this one included, behind a confirmation that says
 *   so. It is the lost-laptop button, and it is the one an operator wants to have pressed
 *   deliberately.
 * - **Change password**: the page that already existed and had no link to it.
 *
 * A disclosure rather than an ARIA `menu`: a button that shows a short list of links and
 * buttons, every one of them a Tab stop. The `menu` pattern promises arrow-key roving that a
 * list of three does not need, and promising it without keeping it is worse than not.
 *
 * Renders nothing until the session has said it is signed in. It asks `GET /api/auth/me`
 * itself, because this is mounted in a layout that also serves `/login`: a menu that assumed a
 * session would flash on the way in.
 *
 * Not here yet: the operator's console entry (`canOperateSite`). There is no console to open
 * until G2-15, and an entry pointing at the not-found page would be a defect, not a feature.
 */
export function AccountMenu() {
  const t = useTranslations()
  const { session } = useSession()
  const navigate = useNavigate()
  const toast = useToast()
  const { signOut, signOutEverywhere, busy } = useSignOut()
  const panelId = useId()

  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // Not while the confirmation is up: it is modal, and its own Escape and its own backdrop are
    // the ones that answer. Closing the menu under it would unmount the button the dialog hands
    // the keyboard back to.
    if (!open || confirming) return

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && root.current?.contains(event.target) === false) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      // Back on the control that opened it, so the keyboard is not left on a list that has gone.
      trigger.current?.focus()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, confirming])

  if (session === null || !session.authenticated) return null

  const leave = (result: Awaited<ReturnType<typeof signOut>>) => {
    if (result.ok) {
      navigate('/login', { replace: true })
      return
    }
    toast.show(result.message, { tone: 'danger' })
  }

  const handleSignOut = () => {
    setOpen(false)
    void signOut().then(leave)
  }

  const handleSignOutEverywhere = () => {
    void signOutEverywhere().then((result) => {
      setConfirming(false)
      leave(result)
    })
  }

  return (
    <div
      ref={root}
      className={styles['root']}
      onBlur={(event) => {
        // Tabbing out closes it. `relatedTarget` is `null` for a click on something that cannot
        // take focus (Safari does not focus a button on press), and closing then would unmount
        // the menu between the press and the click it is about to receive.
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setOpen(false)
        }
      }}
    >
      <Button
        ref={trigger}
        type="button"
        variant="secondary"
        size="sm"
        aria-expanded={open}
        // Only while there is something to control: an id that names no element is a dangling
        // reference, and a collapsed disclosure has no list.
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {t.auth.accountMenu}
      </Button>

      {open ? (
        <div id={panelId} className={styles['panel']}>
          <p className={styles['who']}>{t.auth.accountSignedInAs(session.user.email)}</p>
          <Link className={styles['item']} to="/admin/password" onClick={() => setOpen(false)}>
            {t.auth.changePassword}
          </Link>
          <button type="button" className={styles['item']} onClick={handleSignOut}>
            {t.auth.logout}
          </button>
          {/* The menu stays open behind the question, so that cancelling hands the keyboard back
              to this very button instead of to a document whose opener has been unmounted. */}
          <button type="button" className={styles['item']} onClick={() => setConfirming(true)}>
            {t.auth.logoutEverywhere}
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={t.auth.logoutEverywhereTitle}
        description={t.auth.logoutEverywhereHint}
        confirmLabel={t.auth.logoutEverywhere}
        busy={busy}
        onConfirm={handleSignOutEverywhere}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
