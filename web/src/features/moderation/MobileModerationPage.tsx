import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Badge } from '../../design-system/components/Badge'
import { Button } from '../../design-system/components/Button'
import { EmptyState } from '../../design-system/components/EmptyState'
import { Spinner } from '../../design-system/components/Spinner'
import { VisuallyHidden } from '../../design-system/components/VisuallyHidden'
import { fr } from '../../lib/i18n/fr'
import { SwipeCard } from './components/SwipeCard'
import { queueErrorMessage, useModerationQueue } from './hooks/useModerationQueue'
import type { ModerationDecision } from '../../lib/api/dto'
import styles from './MobileModerationPage.module.css'

/**
 * The moderation console for a host who is not at the laptop:
 * `/admin/events/:slug/moderation/mobile`.
 *
 * They are at a table, standing, holding a phone in one hand. The desktop console is
 * built around a dense grid, a keyboard and a selection, and no amount of responsive CSS
 * makes any of those workable with one thumb — so this is a second *view* over the same
 * queue rather than the same view made narrower.
 *
 * What it does not do is as important as what it does:
 *
 * - **No server code.** Same `useModerationQueue`, same endpoints, same SSE channel,
 *   same decisions. A photo judged here and a photo judged on the laptop travel exactly
 *   the same path.
 * - **No filters, no selection, no bulk.** One photo at a time is the entire idea; a
 *   host who wants to work through forty at once has a laptop for that.
 * - **No gesture-only control.** Every decision the swipe can take is also a real
 *   button, because a swipe is invisible to a screen reader and unusable one-handed by
 *   somebody with limited mobility. The gesture is the shortcut, not the interface.
 */
export function MobileModerationPage() {
  const { slug } = useParams()

  /**
   * `undoOfPublish` is the one thing this surface asks the queue for that the desktop
   * does not. There, a photo the host has just published is still on screen with a
   * "retirer de l'écran" button on it; here it is gone the instant the decision lands,
   * so without this a mis-swipe to the right would be unrecoverable from the phone.
   */
  const queue = useModerationQueue(slug, { undoOfPublish: 'hide' })

  /**
   * The photo in hand: the first one still awaiting a decision.
   *
   * Derived rather than held as an index, and that is what makes the screen survive
   * everything that happens around it. A decision changes the photo's status locally
   * before the server confirms, so the card advances immediately; a refetch triggered
   * by the stream can add, remove or reorder photos under the host without the screen
   * pointing at the wrong one; and an undo that puts a photo back becomes visible for
   * the same reason, with no bookkeeping to get wrong.
   */
  const current = queue.items.find((item) => item.status === 'pending') ?? null

  const authorInName =
    current === null ? null : (current.authorName ?? fr.moderation.anonymousInName)

  /**
   * The last decision the host took, kept only to explain a greyed-out undo.
   *
   * Nothing is said before the first decision: a line about refusals not being
   * reversible, on a screen where nothing has been refused, explains a situation the
   * host is not in.
   */
  const [lastDecision, setLastDecision] = useState<ModerationDecision | null>(null)

  /**
   * Which clip is running, named by its photo rather than held as a boolean.
   *
   * Derived comparison rather than stored state, for the same reason `current` is
   * derived: the card advances the instant a decision lands, and a boolean would leave
   * the next clip already "playing" — a card that begins with sound the host did not ask
   * for, in a room. Naming the photo means the answer resets itself.
   */
  const [playingId, setPlayingId] = useState<string | null>(null)
  /**
   * What playback did that the host did not ask for, and which photo it happened to.
   *
   * Named by photo for the same reason `playingId` is: the card advances on its own, and
   * a flag would carry one clip's trouble onto the next one's.
   *
   * It is a **notice, never a replacement for the control**. A failed metadata fetch on a
   * venue phone is transient and arrives before the host has pressed anything, so
   * swapping the button out for a sentence would make one network blip cost them the
   * ability to watch that clip for the rest of the session.
   */
  const [notice, setNotice] = useState<{ photoId: string; kind: 'failed' | 'muted' } | null>(null)
  const isClip = current !== null && current.kind === 'clip' && current.videoUrl !== null
  const playing = current !== null && playingId === current.id
  const currentNotice = current !== null && notice?.photoId === current.id ? notice.kind : null

  /**
   * Take a decision on a named photo, and on that photo only.
   *
   * Two guards, both of which exist because the card advances *before* the server
   * answers — that optimism is what keeps the console usable on venue Wi-Fi, and it is
   * also what makes a second press dangerous:
   *
   * - **Nothing while a decision is in flight.** The host taps "Publier", the request
   *   hangs on a saturated network, they tap again — and without this the second tap
   *   lands on the photo that has just slid into place, which nobody has looked at. The
   *   buttons show `loading` for the same reason: a control that ignores a press must
   *   say why.
   * - **Only the photo the gesture began on.** The decision names its photo rather than
   *   taking whatever is in hand when the handler runs. Today the card is keyed by id
   *   so a mid-gesture swap unmounts the gesture with it, and this check cannot fire —
   *   it is here so that a later refactor which drops the key cannot quietly turn a
   *   swipe into a decision on the next photo.
   */
  const decide = (decision: ModerationDecision, photoId: string) => {
    if (queue.busy) return
    if (current === null || current.id !== photoId) return
    setLastDecision(decision)
    // Playback stops with the decision, and this is not tidiness. The status is applied
    // optimistically, so a refusal the server sends back — `photo.illegalTransition`, a
    // dropped connection — rolls the photo back to `pending` and puts *this* clip in hand
    // again. With the id still stored, the remounted card would start playing, with
    // sound, in a room, without anybody asking for it.
    setPlayingId(null)
    void queue.decide(photoId, decision)
  }

  /**
   * What the live region says: the photo now in hand, or that there is none left.
   *
   * Silent while the first queue is still loading or has failed — the spinner carries
   * its own `role="status"`, and the failure is a heading the host lands on. A live
   * region that narrated every state of the screen would be a region nobody listens to.
   */
  const announcement = (): string => {
    if (queue.items.length === 0 && (queue.loading || queue.error !== null)) return ''
    if (current === null || authorInName === null) return fr.moderation.empty
    // "Vidéo" rather than "photo" where it is one: a host who cannot see the screen has
    // to know that what is in hand has fifteen seconds in it before they decide, and the
    // play button below is announced only after they have heard what it is for.
    const describe = current.kind === 'clip' ? fr.moderation.videoAlt : fr.moderation.photoAlt
    const describeWithCaption =
      current.kind === 'clip'
        ? fr.moderation.videoAltWithCaption
        : fr.moderation.photoAltWithCaption
    return fr.mobileModeration.nowDeciding(
      current.caption === null
        ? describe(authorInName)
        : describeWithCaption(current.caption, authorInName),
    )
  }

  if (slug === undefined) {
    return <EmptyState as="h1" title={fr.shell.notFoundTitle} description={fr.shell.notFoundHint} />
  }

  return (
    <div className={styles['page']}>
      <header className={styles['head']}>
        <h1 className={styles['title']}>{fr.mobileModeration.title}</h1>
        <div className={styles['badges']}>
          {/* One live region per concern. The count moves on its own as guests upload,
              and a host holding the phone at their side still needs to be told. */}
          <div aria-live="polite">
            <Badge tone={queue.pendingCount > 0 ? 'warning' : 'neutral'}>
              {fr.moderation.pending(queue.pendingCount)}
            </Badge>
          </div>
          <div aria-live="polite">
            <Badge tone={queue.connected ? 'success' : 'warning'}>
              {queue.connected ? fr.moderation.live : fr.moderation.liveLost}
            </Badge>
          </div>
        </div>
        <p className={styles['intro']}>{fr.mobileModeration.intro}</p>
      </header>

      {/*
        What is in hand, said out loud.

        The card is replaced silently when a decision lands, so a host who is not
        looking at the screen — which is the whole premise of this surface — hears "1
        photo publiée" and then nothing about what they are now about to decide. The
        region is mounted unconditionally and empty of chrome: a live region has to
        exist before its content changes, or the first announcement is swallowed.
      */}
      <VisuallyHidden as="div">
        <p aria-live="polite">{announcement()}</p>
      </VisuallyHidden>

      {/* A refetch that failed while the host was working says so and keeps the photo
          on screen, rather than replacing a usable queue with an error page. */}
      {queue.error !== null && queue.items.length > 0 ? (
        <p role="alert" className={styles['staleError']}>
          {queueErrorMessage(queue.error)}
        </p>
      ) : null}

      <div className={styles['stage']}>
        {queue.loading && queue.items.length === 0 ? (
          <div className={styles['pending']} aria-busy="true">
            <Spinner size="lg" label={fr.app.loading} />
          </div>
        ) : queue.error !== null && queue.items.length === 0 ? (
          <EmptyState
            as="h2"
            title={fr.moderation.loadFailed}
            description={queueErrorMessage(queue.error)}
            action={
              <Button variant="primary" onClick={queue.refresh}>
                {fr.app.retry}
              </Button>
            }
          />
        ) : current === null ? (
          <EmptyState as="h2" title={fr.moderation.empty} description={fr.moderation.emptyHint} />
        ) : (
          // Keyed by the photo, so the next one arrives with the gesture reset instead
          // of inheriting the offset the last swipe left behind — and so a photo that
          // changes under a thumb takes the gesture with it rather than inheriting it.
          //
          // `disabled` while a decision is in flight: the card must not move for a
          // gesture the page is about to refuse. Two quick swipes are the same hazard as
          // two quick taps.
          <SwipeCard
            key={current.id}
            photo={current}
            disabled={queue.busy}
            onDecide={decide}
            playing={playing}
            onPlaybackEnded={(reason) => {
              // `muted` is the one that keeps playing: the browser refused sound and the
              // clip is running without it, so the button stays "mettre en pause".
              if (reason === 'muted') {
                setNotice({ photoId: current.id, kind: 'muted' })
                return
              }
              setPlayingId(null)
              if (reason === 'failed') setNotice({ photoId: current.id, kind: 'failed' })
            }}
          />
        )}
      </div>

      {/*
        Everything pressable, together, in the bottom third of the screen — the same
        rule the guest upload page follows, for the same reason: a control in the top
        half of a phone needs a second hand, and this host is holding something in it.

        The bar is rendered whether or not there is a photo, so the buttons do not move
        between decisions. A target that shifts under a thumb is how a host publishes
        the photo they meant to refuse.
      */}
      <div className={styles['actions']}>
        {/*
          The play control, and it is here rather than on the card for a reason that is
          not cosmetic: the card is a drag surface, and a button inside one fires on a
          gesture meant for the card — an aborted swipe becomes a tap, and a tap near the
          bottom of the card becomes a scrub. So playback is requested from the action
          bar, at the same 44 px target as every decision beside it.

          It is also the accessible path rather than a fallback. A swipe is invisible to
          a screen reader and native video controls inside a drag surface would be worse
          than none; a real button with a real label is the only way this clip can be
          watched without sight or without fine motor control.

          Rendered only for a clip, and above the decisions so the host's thumb does not
          pass over "Refuser" on its way to "Lire".
        */}
        {isClip && current !== null && authorInName !== null ? (
          <>
            <Button
              variant="secondary"
              size="lg"
              block
              aria-label={
                playing
                  ? fr.moderation.pauseVideo(authorInName)
                  : fr.moderation.playVideo(authorInName)
              }
              onClick={() => {
                // A fresh attempt clears what the last one said. A phone that dropped a
                // metadata fetch a moment ago will very often manage it now, and the host
                // must not be left reading a stale refusal over a clip that plays.
                setNotice(null)
                setPlayingId(playing ? null : current.id)
              }}
            >
              {playing
                ? fr.moderation.pauseVideo(authorInName)
                : fr.moderation.playVideo(authorInName)}
            </Button>
            {/* Beside the control, never instead of it. */}
            {currentNotice === null ? null : (
              <p className={styles['undoHint']} role="status">
                {currentNotice === 'muted'
                  ? fr.moderation.videoMuted
                  : fr.moderation.videoUnplayable}
              </p>
            )}
          </>
        ) : null}

        <div className={styles['decisions']}>
          {/*
            `loading` while a decision is in flight, which is what `Button` turns into
            `aria-busy` plus `disabled`. Both halves matter: the disabled half is what
            stops an impatient second tap deciding the photo that has just slid into
            place, and the busy half is what tells the host the first press registered —
            a control that silently ignores a tap on a slow network is a control people
            tap harder.
          */}
          <Button
            variant="danger"
            size="lg"
            block
            loading={queue.busy}
            disabled={current === null}
            aria-label={authorInName === null ? undefined : fr.moderation.rejectPhoto(authorInName)}
            onClick={() => {
              if (current !== null) decide('reject', current.id)
            }}
          >
            {fr.moderation.reject}
          </Button>
          <Button
            variant="primary"
            size="lg"
            block
            loading={queue.busy}
            disabled={current === null}
            aria-label={
              authorInName === null ? undefined : fr.moderation.publishPhoto(authorInName)
            }
            onClick={() => {
              if (current !== null) decide('publish', current.id)
            }}
          >
            {fr.moderation.publish}
          </Button>
        </div>

        {/*
          Always on the screen, not carried by a toast that expires. A host looks up at
          the projector, sees what they just did, and looks back — on the laptop the
          undo is an action on the decision's own notice, which is reachable because the
          keyboard is right there. Standing at a table, the affordance has to still be
          where it was.
        */}
        <Button variant="ghost" block disabled={!queue.canUndo} onClick={() => void queue.undo()}>
          {fr.mobileModeration.undoLast}
        </Button>
        {/*
          Said only to a host who has just met the limit — after a refusal, which is the
          one decision here that nothing takes back. Shown on first paint it would
          explain a situation nobody is in yet.
        */}
        {!queue.canUndo && lastDecision === 'reject' ? (
          <p className={styles['undoHint']}>{fr.mobileModeration.undoUnavailable}</p>
        ) : null}
      </div>
    </div>
  )
}
