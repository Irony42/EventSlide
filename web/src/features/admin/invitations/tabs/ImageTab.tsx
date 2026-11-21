import { useEffect, useRef, useState } from 'react'
import { Button } from '../../../../design-system/components/Button'
import { Field } from '../../../../design-system/components/Field'
import { Notice } from '../../../../design-system/components/Notice'
import { Textarea } from '../../../../design-system/components/Textarea'
import { CheckboxField } from '../../../../design-system/components/CheckboxField'
import { copyToClipboard } from '../../../../lib/clipboard'
import { isAbortError } from '../../../../lib/http'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import { graphemesOf } from '../../../../lib/invite/cardTexts'
import { SHARE_TEXT_MAX, shareTextOf, withoutAddress } from '../../../../lib/invite/shareText'
import { renderCardPng, type RenderPng } from './imageRender'
import {
  DEFAULT_INVITE_SHOT,
  INVITE_SHOTS,
  readInvitePreferences,
  writeInvitePreferences,
  type InvitePreferences,
  type InviteShot,
} from './invitePreferences'
import { ShotCard } from './ShotCard'
import { SHOT_SIZE } from './shotSize'
import type { InvitationTabProps } from './tabProps'
import { useInviteImage } from './useInviteImage'
import styles from './ImageTab.module.css'

export interface ImageTabProps extends InvitationTabProps {
  /** Makes the PNG; the browser's own by default, a double in a component test. */
  readonly renderPng?: RenderPng
}

type Said = 'copied' | 'copiedBeforeShare' | 'copyFailed' | 'downloaded' | 'shareFailed' | null

/**
 * The "Image à partager" tab: the card on a square or story background, to post or send (spec 29).
 *
 * Surface: the host's phone or desk. The picture is the paper's card in the same design, colour,
 * photo and short word (read from this device's choices), and it is **made before the tap**, so the
 * native share sheet opens from the gesture. The address is **left off by default**: a story is seen
 * by everyone who follows the host. Nothing is uploaded: the image is made here and handed to the
 * share sheet or to a download.
 */
export function ImageTab({ event, invite, renderPng = renderCardPng }: ImageTabProps) {
  const t = useTranslations()
  const text = t.guestInvite.image
  const slug = event.slug
  const [preferences, setPreferences] = useState<InvitePreferences>(() =>
    readInvitePreferences(slug),
  )
  const shot: InviteShot = preferences.shot ?? DEFAULT_INVITE_SHOT
  const showAddress = preferences.showAddress ?? false
  const picture = useInviteImage({
    event,
    invite,
    preferences,
    shot,
    fileName: `${text.fileName}-${shot}.png`,
    renderPng,
  })
  const { view, photoUrl, backdropUrl, node, image, file } = picture

  const update = (next: InvitePreferences) => {
    setPreferences(next)
    writeInvitePreferences(slug, next)
  }

  // The words that go with the picture, in the language of the invitation; the host may rewrite them.
  const automatic = shareTextOf(
    {
      title: view.texts.title,
      day: view.when.day,
      hours: view.when.hours,
      venue: invite.venueName,
      address: showAddress ? invite.address : null,
      url: invite.url,
    },
    view.lang,
  )
  // The host's rewriting is theirs only for the invitation it was written from: a new date, place,
  // word or link in the form is a new text, and the old edit goes with it. (Showing or hiding the
  // address is not a new invitation: that one is handled below.)
  const wordsKey = JSON.stringify([
    view.texts.title,
    view.when.day,
    view.when.hours,
    invite.venueName,
    invite.address,
    invite.url,
    view.lang,
  ])
  const [rewrite, setRewrite] = useState<{ readonly key: string; readonly text: string } | null>(
    null,
  )
  const edited = rewrite !== null && rewrite.key === wordsKey ? rewrite.text : null
  const setEdited = (value: string | null) => {
    setRewrite(value === null ? null : { key: wordsKey, text: value })
    setSaid(null)
  }
  const words = edited ?? automatic

  /** Showing or hiding the address: the host's own words never keep one the image no longer shows. */
  const showAddressOn = (checked: boolean) => {
    if (!checked && edited !== null && invite.address !== null) {
      setEdited(withoutAddress(edited, invite.address))
    }
    update({ ...preferences, showAddress: checked })
  }

  // The button is there as soon as the phone can share at all, and waits for the picture; it goes
  // away only when the phone says it cannot share this file.
  const canShareAtAll =
    typeof navigator.share === 'function' && typeof navigator.canShare === 'function'
  const canShare = canShareAtAll && (file === null || navigator.canShare({ files: [file] }))
  const sharingNow = useRef(false)
  const [sharing, setSharing] = useState(false)

  const [said, setSaid] = useState<Said>(null)

  // The preview is the picture itself, shrunk to the room there is.
  const frame = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.3)
  useEffect(() => {
    const element = frame.current
    if (element === null) return
    const measure = () => {
      const room = element.getBoundingClientRect().width
      if (room > 0) setScale(Math.min(1, room / SHOT_SIZE[shot].width))
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [shot])

  const copy = async () => setSaid((await copyToClipboard(words)) ? 'copied' : 'copyFailed')

  const download = () => {
    if (file === null) return
    const url = URL.createObjectURL(file)
    const link = Object.assign(document.createElement('a'), { href: url, download: file.name })
    // Some browsers ignore a click on an anchor that is not in the page.
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    setSaid('downloaded')
  }

  const share = async () => {
    // One sheet at a time: a second tap while it is open is the system's `InvalidStateError`.
    if (file === null || sharingNow.current) return
    sharingNow.current = true
    setSharing(true)
    // Both start inside the tap: the sheet only opens from a gesture, so nothing is awaited before it.
    const copying = copyToClipboard(words)
    try {
      await navigator.share({ files: [file], text: words })
      setSaid((await copying) ? 'copiedBeforeShare' : 'copyFailed')
    } catch (cause) {
      const copied = await copying
      if (isAbortError(cause)) {
        // Closing the sheet is a decision, not a failure.
        setSaid(copied ? 'copied' : null)
      } else if (cause instanceof DOMException && cause.name === 'InvalidStateError') {
        // A sheet is already open: the first tap's answer is the one that counts.
        setSaid(null)
      } else {
        setSaid('shareFailed')
      }
    } finally {
      sharingNow.current = false
      setSharing(false)
    }
  }

  const busy = image.status === 'rendering'
  const size = SHOT_SIZE[shot]

  return (
    <div className={styles['tab']}>
      <div className={styles['controls']}>
        <p className={styles['help']}>{text.sameLook}</p>

        <fieldset className={styles['group']}>
          <legend className={styles['legend']}>{text.formatLegend}</legend>
          <div className={styles['row']}>
            {INVITE_SHOTS.map((choice) => (
              <label key={choice} className={styles['radio']}>
                <input
                  type="radio"
                  name="invite-shot"
                  value={choice}
                  checked={shot === choice}
                  onChange={() => update({ ...preferences, shot: choice })}
                />
                {choice === 'square' ? text.formatSquare : text.formatStory}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles['group']}>
          <legend className={styles['legend']}>{text.addressLegend}</legend>
          <CheckboxField
            label={text.addressLabel}
            checked={showAddress}
            disabled={invite.address === null}
            onChange={showAddressOn}
          />
          <p className={styles['help']}>{text.addressHint}</p>
        </fieldset>

        <Field label={text.textLabel} hint={text.textNote}>
          {(control) => (
            <Textarea
              {...control}
              rows={6}
              grow={false}
              value={words}
              maxLength={SHARE_TEXT_MAX}
              onChange={(e) =>
                setEdited(graphemesOf(e.target.value).slice(0, SHARE_TEXT_MAX).join(''))
              }
            />
          )}
        </Field>
        {edited === null ? null : (
          <button type="button" className={styles['revert']} onClick={() => setEdited(null)}>
            {text.revertText}
          </button>
        )}

        <div className={styles['actions']}>
          {canShare ? (
            <Button
              variant="primary"
              onClick={() => void share()}
              disabled={file === null || sharing}
              aria-busy={busy || sharing}
            >
              {text.share}
            </Button>
          ) : null}
          <Button
            variant={canShare ? 'secondary' : 'primary'}
            onClick={download}
            disabled={file === null}
            aria-busy={busy}
          >
            {busy ? text.rendering : text.download}
          </Button>
          <Button onClick={() => void copy()}>{text.copy}</Button>
        </div>

        {image.status === 'failed' ? (
          <Notice tone="warning" role="alert" variant="boxed">
            {text.renderFailed} <Button onClick={picture.retry}>{text.retry}</Button>
          </Notice>
        ) : null}
        <div role="status" aria-live="polite">
          {said === null ? null : (
            <Notice
              tone={said === 'shareFailed' || said === 'copyFailed' ? 'warning' : 'neutral'}
              variant="inline"
            >
              {text[said]}
            </Notice>
          )}
        </div>
        <p className={styles['help']}>{text.help}</p>
      </div>

      <section className={styles['preview']} aria-label={text.previewLabel}>
        <div
          ref={frame}
          className={styles['frame']}
          style={{ aspectRatio: `${size.width} / ${size.height}` }}
        >
          <div
            className={styles['scaled']}
            style={{
              transform: `scale(${scale})`,
              width: `${size.width}px`,
              height: `${size.height}px`,
            }}
          >
            <ShotCard
              view={view}
              eventName={event.name}
              url={invite.url}
              startsAt={invite.startsAt}
              shot={shot}
              photoUrl={photoUrl}
              backdropUrl={backdropUrl}
              nodeRef={node}
            />
          </div>
        </div>
      </section>
    </div>
  )
}
