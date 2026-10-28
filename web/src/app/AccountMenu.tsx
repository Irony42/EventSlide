import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../design-system/components/Button'
import { ConfirmDialog } from '../design-system/components/ConfirmDialog'
import { useToast } from '../design-system/components/useToast'
import { useClientLimits } from '../features/admin/hooks/useClientLimits'
import { useSignOut } from '../features/auth/hooks/useAuthActions'
import { useTranslations } from '../lib/i18n/useTranslations'
import { hereAsFrom } from '../lib/landing'
import { useAbout } from './useAbout'
import { useSession } from './useSession'
import styles from './AccountMenu.module.css'

/**
 * The signed-in account's way out, in the header of the host's own screens.
 *
 * Surface: **the host and the moderator**, on a laptop or a phone, on `/admin/**`. 1.0 had no
 * control that signed anybody out — `api.logout` was never called — so a laptop passed to the
 * next person at a venue stayed the host's, and a lost phone was a session nobody could end.
 *
 * **The list of events** comes first, for every signed-in account: the header holds the language
 * and this menu and nothing else, and from an event's own page there was no way to the list that
 * carries "Nouvel évènement". The event pages carry a trail to it too (`HostBreadcrumb`); this is
 * the way from every other screen. It is not gated: the list answers each account with the events
 * it owns or moderates, so a moderator-only account has one to open as well.
 *
 * Then three entries, each with its own reason:
 *
 * - **Sign out**: this browser. Navigates to the sign-in page *after* the server has said the
 *   session is gone, never before: a menu that left while the request failed would show a
 *   signed-out page over a session that is still valid.
 * - **Sign out everywhere**: every device, this one included, behind a confirmation that says
 *   so. It is the lost-laptop button, and it is the one an operator wants to have pressed
 *   deliberately.
 * - **Change password**: the page that already existed and had no link to it.
 *
 * **Security** (the second factor, H7) is offered when the box has a key to enrol with, or the
 * account has already enrolled: `secondFactor.available || enrolled`. Until then the page was
 * reachable only by typing its address, and for an operator the console's gate was the one link to it.
 *
 * **While the password must be changed** (`mustChangePassword`, H15) every address of the console
 * leads back to the one page, so the menu offers no destination at all: it says why, and keeps the
 * two ways out. The entry for the page itself goes too: the person is on it.
 *
 * **The entry for the page you are on is marked** (`aria-current="page"`, H17), and the links
 * that leave for a page you may want to come back from (password, security) carry `from`.
 *
 * A disclosure rather than an ARIA `menu`: a button that shows a short list of links and
 * buttons, every one of them a Tab stop. The `menu` pattern promises arrow-key roving that a
 * list of three does not need, and promising it without keeping it is worse than not.
 *
 * Renders nothing until the session has said it is signed in. It reads the shared session
 * (`SessionProvider`) rather than assuming one, because this is mounted in a layout that also
 * serves `/login`: a menu that assumed a session would flash on the way in.
 *
 * **The client space** (G2-16 / P3-17) is offered above them to a member of a client, on a box
 * that has one. **The operator's console** (G2-15 / P3-16) is offered to the account that operates
 * the box, on a box that has a console: `canOperateSite` **and** `features.siteAdmin`, which are
 * different questions (an operator of a box with `SITE_ADMIN=off` still reads `true` and has no
 * console to open, and an entry pointing at the not-found page would be a defect, not a feature).
 */
export function AccountMenu() {
  const t = useTranslations()
  const { session } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const { signOut, signOutEverywhere, busy } = useSignOut()
  const panelId = useId()
  // The client's own space is offered to a member of a client, and to nobody else: the entry
  // exists only when the box has a client space (`features.siteAdmin`, read by the hook) and
  // the account is in one.
  const mustChange = session?.authenticated === true && session.user.mustChangePassword
  const { clients } = useClientLimits(session?.authenticated === true && !mustChange)
  const consoleExists = useAbout().features.siteAdmin

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
          {mustChange ? (
            <p className={styles['who']}>{t.auth.menuMustChange}</p>
          ) : (
            <>
              {/* Offered to every signed-in account: the list answers each one with the events it
                  owns or moderates, so there is no account for whom it is a dead end. It is the
                  way to "Nouvel évènement" from anywhere in the console. */}
              <Link
                className={styles['item']}
                to="/admin"
                aria-current={location.pathname === '/admin' ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                {t.admin.events}
              </Link>
              {consoleExists && session.user.canOperateSite ? (
                <Link
                  className={styles['item']}
                  to="/admin/site"
                  aria-current={
                    location.pathname === '/admin/site' ||
                    location.pathname.startsWith('/admin/site/')
                      ? 'page'
                      : undefined
                  }
                  onClick={() => setOpen(false)}
                >
                  {t.site.menuLink}
                </Link>
              ) : null}
              {clients.length > 0 ? (
                <Link
                  className={styles['item']}
                  to="/admin/client"
                  aria-current={location.pathname === '/admin/client' ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                >
                  {t.clientSpace.spaceLink}
                </Link>
              ) : null}
              {session.user.secondFactor.available || session.user.secondFactor.enrolled ? (
                <Link
                  className={styles['item']}
                  to="/admin/security"
                  state={{ from: hereAsFrom(location) }}
                  aria-current={location.pathname === '/admin/security' ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                >
                  {t.auth.securityTitle}
                </Link>
              ) : null}
              <Link
                className={styles['item']}
                to="/admin/password"
                state={{ from: hereAsFrom(location) }}
                aria-current={location.pathname === '/admin/password' ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                {t.auth.changePassword}
              </Link>
            </>
          )}
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
