import { DomainError } from '../shared/errors'
import { err, ok, type Result } from '../shared/result'
import type { ChannelMedia } from './inboundMessage'

/**
 * Whether a media posted in a conversation is worth downloading, and what to do with it once it is
 * (spec 27 §4.5). It looks only at what the message *declares*; the real format is still decided by
 * the bytes when the photograph or the clip pipeline reads them, so a lie here costs a refusal later,
 * never a wrong file.
 */

export interface AdmissionLimits {
  /** Smaller of the upload ceiling and what the channel lets a bot download. */
  readonly maxPhotoBytes: number
  /** What a video may weigh before it is downloaded: the channel's download limit. */
  readonly maxVideoBytes: number
  /** `MAX_CLIP_SECONDS` in milliseconds: a longer video keeps its first seconds. */
  readonly maxClipMs: number
  /** `Event.acceptsClips(ceilings)`: the host's switch and the client's ceiling. */
  readonly clipsAccepted: boolean
}

export type MediaTreatment =
  | { readonly kind: 'photo' }
  /** `trim` is the range kept, or `null` for a video short enough to go as it is. */
  | {
      readonly kind: 'video'
      readonly trim: { readonly startMs: number; readonly endMs: number } | null
    }

/**
 * The refusals are stable codes, each worded by `channelReplies.ts`:
 * `channel.mediaTooLarge`, `channel.videoNotAccepted`, `channel.unsupportedFormat`.
 */
export const admitMedia = (
  media: Pick<ChannelMedia, 'kind' | 'declaredBytes' | 'durationMs' | 'declaredMimeType'>,
  limits: AdmissionLimits,
): Result<MediaTreatment, DomainError> => {
  const kind = effectiveKind(media)
  if (kind === null) return err(DomainError.invalid('channel.unsupportedFormat'))

  if (kind === 'photo') {
    if (tooLarge(media.declaredBytes, limits.maxPhotoBytes)) {
      return err(
        DomainError.quotaExceeded('channel.mediaTooLarge', { maxBytes: limits.maxPhotoBytes }),
      )
    }
    return ok({ kind: 'photo' })
  }

  if (!limits.clipsAccepted) return err(DomainError.forbidden('channel.videoNotAccepted'))
  if (tooLarge(media.declaredBytes, limits.maxVideoBytes)) {
    return err(
      DomainError.quotaExceeded('channel.mediaTooLarge', { maxBytes: limits.maxVideoBytes }),
    )
  }
  const longer = media.durationMs !== null && media.durationMs > limits.maxClipMs
  return ok({ kind: 'video', trim: longer ? { startMs: 0, endMs: limits.maxClipMs } : null })
}

/** A document is a photograph or a film only if it says so; anything else is not ours to take. */
const effectiveKind = (
  media: Pick<ChannelMedia, 'kind' | 'declaredMimeType'>,
): 'photo' | 'video' | null => {
  if (media.kind !== 'document') return media.kind
  const mime = (media.declaredMimeType ?? '').toLowerCase()
  if (mime.startsWith('image/')) return 'photo'
  if (mime.startsWith('video/')) return 'video'
  return null
}

/** An undeclared size is let through: the download itself is cut at the limit. */
const tooLarge = (declared: number | null, max: number): boolean =>
  declared !== null && declared > max

/**
 * One sender's rate, from the instants of their recent media. Returns the window to keep and whether
 * this media is within `perMinute`. The counter lives in memory in the use case (lost on restart, which
 * is harmless); what is decided is here.
 */
export const admitByRate = (
  recent: readonly Date[],
  now: Date,
  perMinute: number,
): { readonly allowed: boolean; readonly window: readonly Date[] } => {
  const window = recent.filter((at) => now.getTime() - at.getTime() < 60_000)
  if (window.length >= perMinute) return { allowed: false, window }
  return { allowed: true, window: [...window, now] }
}

/** The channel queue's ceiling per event (`MAX_QUEUED_CHANNEL_MEDIA_PER_EVENT`). */
export const queueHasRoom = (queued: number, max: number): boolean => queued < max
