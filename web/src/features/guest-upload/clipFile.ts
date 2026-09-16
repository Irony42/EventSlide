/**
 * What this phone can tell about a recording **before** it sends it.
 *
 * Not a second copy of the server's rules — the server decides, from the bytes, with
 * `ClipDuration` and `MAX_CLIP_BYTES` — but the same rules asked early enough to be
 * worth something. A guest on venue Wi-Fi who is told `413` after four minutes of
 * uploading has lost the four minutes; a guest told at the picker films a shorter one.
 *
 * So every refusal here is one the server would make anyway, and the limits are the
 * event's own (`PublicEventDto`) rather than constants in this bundle: a number compiled
 * in here is a number no operator's `.env` can move, and it would go quietly wrong the
 * day somebody raises `MAX_CLIP_BYTES` for a venue with good uplink.
 *
 * Pure, and separate from the hook, because these are the only decisions in the flow that
 * are genuinely rules rather than plumbing — the same split `web/src/lib/offline/` makes
 * between `outboxPolicy` and the store.
 */

/** The deployment's limits, as the join response reports them. */
export interface ClipLimits {
  readonly maxBytes: number
  readonly maxSeconds: number
}

/**
 * Why this recording will not be sent. `null` means "nothing this phone can see is
 * wrong with it", which is not the same as "the server will take it".
 */
export type ClipRefusal = 'notAVideo' | 'tooLarge' | 'tooLong' | 'empty'

/** Enough of a `File` to judge, so this can be tested without constructing one. */
export interface ClipCandidate {
  readonly type: string
  readonly size: number
}

/**
 * The two things a phone knows the instant the picker closes: the declared type and the
 * byte length.
 *
 * **An empty `type` is accepted, deliberately.** Several Android pickers and every
 * "share to app" path hand over a `File` with no MIME type at all, and refusing those
 * would refuse ordinary videos from ordinary phones for the sake of a check the server
 * does properly — it identifies the container from the signature and answers
 * `clip.unsupportedFormat` if it is not one. The type is a hint here, never the
 * authority; that distinction is the 1.0 upload defect, written down in CLAUDE.md §3.4.
 */
export const refuseClipFile = (file: ClipCandidate, limits: ClipLimits): ClipRefusal | null => {
  if (file.type !== '' && !file.type.toLowerCase().startsWith('video/')) return 'notAVideo'
  // The server answers `clip.sourceByteSizeInvalid` for this, after the round trip.
  if (file.size <= 0) return 'empty'
  if (file.size > limits.maxBytes) return 'tooLarge'
  return null
}

/**
 * The duration, once the browser has read the container's header.
 *
 * `null` is "the browser could not tell", and it is **not** a refusal. A container whose
 * header this browser cannot parse is one the server may well open — it has ffprobe and
 * a phone has whatever the platform ships — and refusing on our own ignorance would lose
 * a guest's clip for a reason that is ours rather than theirs. The server has the
 * authoritative answer and `clip.durationUnknown` is its word for genuinely not knowing.
 */
export const refuseClipDuration = (
  durationMs: number | null,
  limits: ClipLimits,
): ClipRefusal | null => {
  if (durationMs === null) return null
  /**
   * Compared in **milliseconds**, against exactly the bound the domain applies.
   *
   * `ClipDuration.create` refuses `ms > maxMs`, full stop. Rounding to whole seconds
   * here was an attempt to be generous with a phone encoder's fraction of a second, and
   * it was generous in the one direction that costs the guest something: a 15.4 s
   * recording rounds to 15, passes this check, goes up the venue's Wi-Fi in full, and
   * comes back `clip.tooLong` — which is precisely the round trip this module exists to
   * save them. A client copy of a server rule may be stricter and useless; it may not be
   * looser and misleading.
   */
  return durationMs > limits.maxSeconds * 1_000 ? 'tooLong' : null
}

/**
 * The failure codes where sending the same recording again could only fail the same way.
 *
 * **This is about a button, not about a rule.** The server decides whether a job may be
 * retried and it always may — a `failed` row never blocks a re-upload, deliberately. What
 * this answers is the narrower question a surface has to answer: is offering "Réessayer"
 * honest, or is it a control that exists to be refused? And the cost of getting that
 * wrong is not a wasted tap: the bytes travel before the refusal does, so every offered
 * retry is another eighty megabytes up a venue's Wi-Fi.
 *
 * Two kinds of code qualify, and they are different sentences:
 *
 * - **The bytes are the problem.** An unsupported container, no video stream, forty
 *   seconds against a fifteen-second cap. The same bytes are the same bytes tomorrow.
 * - **This deployment cannot do it at all.** `clip.transcoderUnavailable` means the box
 *   has no encoder, decided once at boot — so it is the one entry here that is *not*
 *   about the recording, and the one machine fault that does not clear on its own.
 *   Nothing changes until somebody redeploys, and until then a retry is a full upload
 *   spent to be told `500` again. (The guest surface should not reach this at all now
 *   that `PublicEventDto.allowClips` folds in the capability — this is the backstop for
 *   the window where a box loses its encoder while a phone holds an older answer.)
 *
 * Everything not named here is offered again, and the default is that way round on
 * purpose. The genuine machine faults — a transcode that timed out under load, a disk
 * that was briefly full — do clear, which is why the domain's own `classifyClipFailure`
 * treats an unknown code as transient. And the two album verdicts,
 * `event.quotaExceeded` and `event.photoLimitReached`, are the reason the server lets a
 * failed job be re-sent at all: a host deletes fifty photographs and the same clip now
 * fits.
 *
 * Transcribed rather than imported: lint forbids the web app importing the server, the
 * same reason `dto.ts` transcribes the wire format. The cost of it drifting is one button
 * offered or withheld — never a clip lost.
 */
const NEVER_ANSWERS_DIFFERENTLY: ReadonlySet<string> = new Set([
  // The recording.
  'clip.unsupportedFormat',
  'clip.corrupt',
  'clip.noVideoStream',
  'clip.durationUnknown',
  'clip.tooShort',
  'clip.tooLong',
  'clip.pixelBudgetExceeded',
  // The deployment.
  'clip.transcoderUnavailable',
])

/** Whether a second attempt at this failure could answer differently. */
export const mayAnswerDifferently = (failureCode: string | null | undefined): boolean =>
  failureCode === null || failureCode === undefined || !NEVER_ANSWERS_DIFFERENTLY.has(failureCode)

/**
 * Megabytes, as a guest reads them.
 *
 * Decimal, because `MAX_CLIP_BYTES` is `80_000_000` and the sentence a guest is shown
 * has to say "80 Mo" rather than "76 Mo" — otherwise the number in the hint and the
 * number in the refusal are two different numbers for one limit.
 */
export const megabytes = (bytes: number): number => Math.round(bytes / 1_000_000)
