import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../../../design-system/components/Button'
import { Field } from '../../../../design-system/components/Field'
import { Notice } from '../../../../design-system/components/Notice'
import { Textarea } from '../../../../design-system/components/Textarea'
import { CheckboxField } from '../../../../design-system/components/CheckboxField'
import { copyToClipboard } from '../../../../lib/clipboard'
import { isAbortError } from '../../../../lib/http'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import { shareTextOf } from '../../../../lib/invite/shareText'
import { readPrintPhoto } from '../../print/printPhoto'
import { blurPhoto, renderCardPng, type RenderPng } from './imageRender'
import { inviteCardOf } from './inviteCard'
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
import { useCardImage } from './useCardImage'
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
  const photoUrl = useMemo(() => readPrintPhoto(slug), [slug])
  const shot: InviteShot = preferences.shot ?? DEFAULT_INVITE_SHOT
  const showAddress = preferences.showAddress ?? false
  const view = inviteCardOf(event, invite, preferences, { showAddress })

  const update = (next: InvitePreferences) => {
    setPreferences(next)
    writeInvitePreferences(slug, next)
  }

  // The ground: the photograph, blurred; the card's colour until it is, and without one.
  const [backdrop, setBackdrop] = useState<{
    readonly of: string
    readonly url: string | null
  } | null>(null)
  useEffect(() => {
    if (photoUrl === null) return
    let cancelled = false
    void blurPhoto(photoUrl).then((url) => {
      if (!cancelled) setBackdrop({ of: photoUrl, url })
    })
    return () => {
      cancelled = true
    }
  }, [photoUrl])
  const backdropUrl = photoUrl !== null && backdrop?.of === photoUrl ? backdrop.url : null
  const backdropPending = photoUrl !== null && backdrop?.of !== photoUrl

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
  const [edited, setEdited] = useState<string | null>(null)
  const words = edited ?? automatic

  const node = useRef<HTMLDivElement>(null)
  const image = useCardImage(
    node,
    JSON.stringify([
      shot,
      view.design,
      view.invitation,
      view.colour,
      photoUrl,
      view.focusX,
      view.focusY,
      view.texts,
      backdropUrl,
    ]),
    SHOT_SIZE[shot],
    renderPng,
    backdropPending,
  )
  const ready = image.status === 'ready' ? image.blob : null
  const file = useMemo(
    () =>
      ready === null
        ? null
        : new File([ready], `${text.fileName}-${shot}.png`, { type: 'image/png' }),
    [ready, shot, text.fileName],
  )
  const canShare =
    file !== null &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })

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
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
    setSaid('downloaded')
  }

  const share = async () => {
    if (file === null) return
    // Both start inside the tap: the sheet only opens from a gesture, so nothing is awaited before it.
    const copying = copyToClipboard(words)
    try {
      await navigator.share({ files: [file], text: words })
    } catch (cause) {
      const copied = await copying
      // Closing the sheet is a decision, not a failure.
      setSaid(isAbortError(cause) ? (copied ? 'copied' : null) : 'shareFailed')
      return
    }
    setSaid((await copying) ? 'copiedBeforeShare' : 'copyFailed')
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
            onChange={(checked) => update({ ...preferences, showAddress: checked })}
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
              onChange={(e) => setEdited(e.target.value)}
            />
          )}
        </Field>

        <div className={styles['actions']}>
          {canShare ? (
            <Button variant="primary" onClick={() => void share()}>
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
            {text.renderFailed}
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
