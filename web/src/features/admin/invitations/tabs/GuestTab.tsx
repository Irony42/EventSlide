import { useState } from 'react'
import { GuestInvitation } from '../../../../app/GuestInvitation'
import { NO_RSVP_PAGE } from '../../../../lib/rsvp/rsvpDraft'
import { Button } from '../../../../design-system/components/Button'
import { Notice } from '../../../../design-system/components/Notice'
import { useToast } from '../../../../design-system/components/useToast'
import type { GuestInvitePageDto } from '../../../../lib/api/dto'
import { copyToClipboard } from '../../../../lib/clipboard'
import { LocaleOverride } from '../../../../lib/i18n/LocaleProvider'
import { DEFAULT_LOCALE, parseLocale } from '../../../../lib/i18n/locale'
import { useTranslations } from '../../../../lib/i18n/useTranslations'
import { PreviewBox } from './PreviewBox'
import type { OutputProps } from './tabProps'
import { useFitScale } from './useFitScale'
import styles from './GuestTab.module.css'

type Moment = GuestInvitePageDto['state']
const MOMENTS: readonly Moment[] = ['upcoming', 'joinable', 'over']

/** The phone's own width, in CSS pixels: the page is drawn at it and shrunk to the room. */
const PHONE_WIDTH = 375
/** A phone is about twice as tall as wide. */
const PHONE_RATIO: readonly [number, number] = [9, 18.5]
const PHONE_HEIGHT = Math.round((PHONE_WIDTH * PHONE_RATIO[1]) / PHONE_RATIO[0])

/**
 * The guest's page, shown the way a guest sees it (spec 29): what opens at the link or the QR code,
 * in a phone frame, from **what the host is typing** (not only what is saved). The page is the one
 * the guest sees (`app/GuestInvitation`), fed with the draft; the server's `state` is the one thing
 * it cannot know here, so the host picks the moment (before, during, after) to look at each.
 * Surface: the host's laptop. The frame is out of reach of the keyboard and the pointer: nothing in
 * it can be pressed, and nothing is sent anywhere.
 */
export function GuestTab({ event, invite, children }: OutputProps) {
  const t = useTranslations()
  const text = t.guestInvite.host
  const toast = useToast()
  // Read once: the preview does not tick, and the render stays the same for the same draft.
  const [readAt] = useState(() => Date.now())
  const [moment, setMoment] = useState<Moment>('upcoming')
  const [frame, scale] = useFitScale(PHONE_WIDTH)
  const language = parseLocale(invite.language) ?? DEFAULT_LOCALE

  const page: GuestInvitePageDto = {
    state: moment,
    title: invite.title ?? event.name,
    when: {
      startsAt: invite.startsAt,
      endsAt: invite.endsAt,
      timeZone: invite.timeZone ?? 'UTC',
    },
    venueName: invite.venueName,
    // What the server says of an evening that is over: no address, no word.
    ...(moment === 'over' ? {} : { address: invite.address, message: invite.message }),
    language: invite.language,
    accentHue: event.settings.theme.accentHue,
    // The host's own preview shows no answering block until the panel of the replies exists.
    rsvp: { ...NO_RSVP_PAGE },
    ...(moment === 'joinable' ? { joinUrl: `/join/${event.joinCode}` } : {}),
  }

  const copy = async () => {
    const copied = await copyToClipboard(invite.url)
    toast.show(copied ? text.copied : text.copyFailed, { tone: copied ? 'success' : 'warning' })
  }

  const options = (
    <div className={styles['controls']}>
      <fieldset className={styles['group']}>
        <legend className={styles['legend']}>{text.guestStateLegend}</legend>
        {MOMENTS.map((choice) => (
          <label key={choice} className={styles['radio']}>
            <input
              type="radio"
              name="invite-guest-moment"
              value={choice}
              checked={moment === choice}
              onChange={() => setMoment(choice)}
            />
            {choice === 'upcoming'
              ? text.guestStateUpcoming
              : choice === 'joinable'
                ? text.guestStateJoinable
                : text.guestStateOver}
          </label>
        ))}
      </fieldset>
      <p className={styles['help']}>{text.guestHelp}</p>
      <Notice tone="accent" variant="boxed">
        {text.openNote}
      </Notice>
    </div>
  )

  const actions = (
    <div className={styles['actions']}>
      <Button
        variant="primary"
        onClick={() => window.open(invite.url, '_blank', 'noopener,noreferrer')}
      >
        {text.guestOpen}
      </Button>
      <Button onClick={() => void copy()}>{text.guestCopy}</Button>
    </div>
  )

  const preview = (
    <PreviewBox ratio={PHONE_RATIO} label={text.guestPreviewLabel}>
      <div ref={frame} className={styles['phone']}>
        <div
          className={styles['scaled']}
          style={{
            transform: `scale(${scale})`,
            width: `${PHONE_WIDTH}px`,
            height: `${PHONE_HEIGHT}px`,
          }}
        >
          {/* Scrolls like a phone does; what is inside cannot be reached, so nothing is pressed or sent. */}
          <div
            className={styles['screen']}
            tabIndex={0}
            role="group"
            aria-label={text.guestPreviewLabel}
          >
            <div inert>
              <LocaleOverride locale={language}>
                <GuestInvitation page={page} token="preview" readAt={readAt} interactive={false} />
              </LocaleOverride>
            </div>
          </div>
        </div>
      </div>
    </PreviewBox>
  )

  return <>{children({ preview, options, actions })}</>
}
