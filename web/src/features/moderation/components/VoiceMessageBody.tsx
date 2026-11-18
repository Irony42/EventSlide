import { Badge } from '../../../design-system/components/Badge'
import { guestbookDateFormat } from '../../../app/guestbookRow'
import { useApi } from '../../../lib/useApi'
import { formatClock } from '../../../lib/format'
import { useLocale, useTranslations } from '../../../lib/i18n/useTranslations'
import type { GuestbookQueueItemDto } from '../../../lib/api/dto'
import styles from './VoiceMessageBody.module.css'

export interface VoiceMessageBodyProps {
  readonly slug: string
  readonly message: GuestbookQueueItemDto
  /** The name shown for the author, for the player's accessible name. */
  readonly author: string
  /** The secret is on: said in words, with no player (spec 25, rule 10). */
  readonly sealed: boolean
  /** When the secret lifts by itself, or `null` for the end of the evening. */
  readonly opensAtMs: number | null
  /** The evening is a disposable camera with the reveal on: the secret lifts when it is revealed. */
  readonly opensWithReveal?: boolean
}

/**
 * What a voice message shows in the console in place of a text (spec 25): its length, its caption
 * if the guest wrote one, and then exactly one of three things. The native player, when the
 * recording is `ready` and not kept secret; "En traitement", when it is not yet; or the plain
 * sentence that it is kept secret, with no player at all and "Vous n’avez pas écouté ce message".
 *
 * The player never starts by itself (`preload="none"`, no `autoplay`): sound is always a gesture
 * of the host. Its accessible name carries the author and the length, because a bare `<audio>`
 * is announced as "audio" and a list of forty of them tells a screen reader nothing.
 */
export function VoiceMessageBody({
  slug,
  message,
  author,
  sealed,
  opensAtMs,
  opensWithReveal = false,
}: VoiceMessageBodyProps) {
  const t = useTranslations()
  const copy = t.guestbookVoiceHost
  const api = useApi()
  const { locale } = useLocale()
  const voice = message.voice
  if (voice === null) return null

  const ready = voice.state === 'ready'
  const duration = voice.durationMs === null ? null : formatClock(voice.durationMs)
  const until =
    opensAtMs === null
      ? opensWithReveal
        ? copy.sealedCardReveal
        : copy.sealedCard
      : copy.sealedUntil(guestbookDateFormat(locale)(new Date(opensAtMs).toISOString()))

  return (
    <div className={styles['voice']} data-sealed={sealed ? 'true' : undefined}>
      <p className={styles['summary']}>
        <Badge tone="neutral">{copy.voiceBadge}</Badge>
        {duration === null ? null : <span>{copy.duration(duration)}</span>}
        {ready ? null : <Badge tone="warning">{copy.processing}</Badge>}
      </p>
      {voice.caption === null || voice.caption === '' ? null : (
        // Guest content: whole, as text, in the language it was written in.
        <p className={styles['caption']} translate="no">
          {voice.caption}
        </p>
      )}
      {!ready ? null : sealed ? (
        <>
          <p className={styles['sealed']}>{until}</p>
          <p className={styles['unheard']}>{copy.notListened}</p>
        </>
      ) : (
        <audio
          className={styles['player']}
          controls
          preload="none"
          src={api.guestbookVoiceUrl(slug, message.id)}
          aria-label={copy.cardLabel(author, duration ?? '')}
        />
      )}
    </div>
  )
}
