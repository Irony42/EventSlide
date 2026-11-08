import type { Transport, UploadProgress } from '../../http'
import type {
  About,
  ClipJobDto,
  ErasedContributionDto,
  GuestMissionListResponse,
  CreatedGuestbookEntryDto,
  MyGuestbookDto,
  MyPhotosDto,
  JoinResponse,
  PrivacyNoticeState,
  ReactionKind,
  ReactionsResponse,
  UploadResponse,
  WallResponse,
} from '../dto'
import { encode } from './shared'

// What a guest and the room call: the public reads, the upload, the guest's own history and reactions.
export interface UploadInput {
  readonly files: readonly File[]
  readonly caption?: string | null
  /**
   * Which of the host prompts the guest tapped before sending (roadmap 2.1).
   *
   * One per request rather than one per file, exactly as the caption is: a guest picks a
   * mission, then picks their photographs, and asking them to file five files one by one
   * on a phone is asking them not to bother.
   */
  readonly missionId?: string | null
  /**
   * The timed challenge answered (spec 18): sent only when the guest left "Je participe au
   * défi" checked. A uuid, so omitted rather than sent empty, like the mission.
   */
  readonly challengeId?: string | null
  readonly onProgress?: (progress: UploadProgress) => void
  readonly signal?: AbortSignal
} /**
 * One clip. Singular, and that is the endpoint's shape rather than this function's.
 *
 * `POST /api/events/:slug/clips` accepts **exactly one** file under the field `clip`;
 * anything else is `LIMIT_UNEXPECTED_FILE` from multer before a line of our code runs.
 * The photo path takes a batch because twenty photographs is an ordinary thing for a
 * guest to have; twenty videos is eight hundred megabytes and a queue nobody drains.
 */
export interface ClipUploadInput {
  readonly file: File
  readonly caption?: string | null
  /** The mission selected when the clip was picked; omitted when none, as for a photo. */
  readonly missionId?: string | null
  /**
   * The part of a too-long recording to keep, in milliseconds from the start of `file`
   * (spec 16). Both bounds travel, or neither.
   */
  readonly trim?: { readonly startMs: number; readonly endMs: number }
  readonly onProgress?: (progress: UploadProgress) => void
  readonly signal?: AbortSignal
}
export const guestApi = (transport: Transport) => ({
  /**
   * What this box is, its licence and where its source is. Public, and answered with no
   * session: the footer on every guest and host screen reads it, and it must never be the
   * thing a screen waits for.
   */
  about: (signal?: AbortSignal): Promise<About> => transport.get('/api/about', undefined, signal),

  join: (joinCode: string, displayName: string | null): Promise<JoinResponse> =>
    transport.post('/api/join', { joinCode, displayName }),

  /**
   * No query string, on purpose. The display URL's `?layout=` and its `e2e_*` timing
   * hooks are read in the browser (`web/src/features/wall/hooks/`) because they are
   * one screen's presentation choices; forwarding them would ask the server to hold
   * this client's view state for the length of a request, and `wallQuery` is `.strict()`
   * so it answers `400 request.invalid` rather than pretend to.
   */
  wall: (slug: string, signal?: AbortSignal): Promise<WallResponse> =>
    transport.get(`/api/events/${encode(slug)}/wall`, undefined, signal),

  uploadPhotos: (slug: string, input: UploadInput): Promise<UploadResponse> => {
    const form = new FormData()
    for (const file of input.files) form.append('photos', file)
    // Omitted rather than sent empty: the server distinguishes "no caption" from an
    // invalid one, and an untouched field must not become a validation error.
    if (input.caption !== undefined && input.caption !== null && input.caption !== '') {
      form.append('caption', input.caption)
    }
    // Same shape as the caption above: omitted rather than sent empty, because the
    // server parses this as a uuid and an empty part would be a 400 on an upload that
    // simply had no mission.
    if (input.missionId !== undefined && input.missionId !== null && input.missionId !== '') {
      form.append('missionId', input.missionId)
    }
    if (input.challengeId !== undefined && input.challengeId !== null && input.challengeId !== '') {
      form.append('challengeId', input.challengeId)
    }
    return transport.upload(`/api/events/${encode(slug)}/photos`, form, {
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    })
  },

  /**
   * Sends a clip and gets back the **job**, not a photo.
   *
   * `202`, and the status code is the contract: nothing exists yet that a moderator
   * could act on. What comes back is the job to watch and the id of the row it will
   * become — which is why the caller's next move is {@link Api.clipJob} rather than a
   * refetch of "Vos envois", where there is nothing to find for the length of the
   * transcode.
   *
   * A repeat of the same bytes answers `202` with the **same** `clipJobId` rather than
   * queueing a second transcode, so a dropped upload on venue Wi-Fi is safe to send
   * again.
   */
  uploadClip: (slug: string, input: ClipUploadInput): Promise<ClipJobDto> => {
    const form = new FormData()
    // The text parts go before the file, which is the order multipart parsers expect them in:
    // a text part that arrives after a large file part is the one a proxy may cut off.
    if (input.trim !== undefined) {
      form.append('startMs', String(Math.round(input.trim.startMs)))
      form.append('endMs', String(Math.round(input.trim.endMs)))
    }
    // Before the file, like the range: a text part after a large file part is the one a proxy may cut.
    if (input.missionId !== undefined && input.missionId !== null && input.missionId !== '') {
      form.append('missionId', input.missionId)
    }
    form.append('clip', input.file)
    // Omitted rather than sent empty, exactly as the photo path does: the server
    // distinguishes "no caption" from an invalid one.
    if (input.caption !== undefined && input.caption !== null && input.caption !== '') {
      form.append('caption', input.caption)
    }
    return transport.upload(`/api/events/${encode(slug)}/clips`, form, {
      ...(input.onProgress ? { onProgress: input.onProgress } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    })
  },

  /**
   * "Where is my clip?" — the one question a guest has while it is transcoding.
   *
   * Answers the same body as the upload. The server sends `Cache-Control: no-store`,
   * because this is the one view whose whole purpose is to change.
   */
  clipJob: (slug: string, clipJobId: string, signal?: AbortSignal): Promise<ClipJobDto> =>
    transport.get(`/api/events/${encode(slug)}/clips/${encode(clipJobId)}`, undefined, signal),

  /**
   * The guest checklist (roadmap 2.1).
   *
   * One read, and one is the requirement rather than an optimisation: the screen that
   * tells a guest there is something to do is fetched on a saturated access point before
   * they have taken a single photograph.
   */
  myMissions: (slug: string, signal?: AbortSignal): Promise<GuestMissionListResponse> =>
    transport.get(`/api/events/${encode(slug)}/missions/mine`, undefined, signal),

  /**
   * The privacy notice in force and whether this device has read it (roadmap §5.1).
   *
   * Asked when the upload screen opens and whenever it comes back into view, because the
   * copy the join left in the session is a snapshot and the host may have changed a
   * setting since.
   */
  privacyNotice: (slug: string, signal?: AbortSignal): Promise<PrivacyNoticeState> =>
    transport.get(`/api/events/${encode(slug)}/privacy-notice`, undefined, signal),

  /**
   * "J'ai compris". The revision is the one the screen showed, sent back as-is; a
   * notice the host changed in the meantime answers `409 privacyNotice.outdated`.
   */
  acknowledgePrivacyNotice: (slug: string, revision: string): Promise<PrivacyNoticeState> =>
    transport.post(`/api/events/${encode(slug)}/privacy-notice/acknowledgement`, { revision }),

  myPhotos: (slug: string, signal?: AbortSignal): Promise<MyPhotosDto> =>
    transport.get(`/api/events/${encode(slug)}/photos/mine`, undefined, signal),

  deleteMyPhoto: (slug: string, photoId: string): Promise<void> =>
    transport.del(`/api/events/${encode(slug)}/photos/${encode(photoId)}`),

  /** The guest's own guestbook messages and whether a new one would be taken (spec 01). */
  myGuestbook: (slug: string, signal?: AbortSignal): Promise<MyGuestbookDto> =>
    transport.get(`/api/events/${encode(slug)}/guestbook/mine`, undefined, signal),

  writeGuestbookEntry: (slug: string, text: string): Promise<CreatedGuestbookEntryDto> =>
    transport.post(`/api/events/${encode(slug)}/guestbook`, { text }),

  deleteMyGuestbookEntry: (slug: string, entryId: string): Promise<void> =>
    transport.del(`/api/events/${encode(slug)}/guestbook/${encode(entryId)}`),

  /** `DELETE …/guests/me`: everything this device's guest sent to the event, and the guest. */
  eraseMyContribution: (slug: string): Promise<ErasedContributionDto> =>
    transport.del(`/api/events/${encode(slug)}/guests/me`),

  react: (slug: string, photoId: string, kind: ReactionKind): Promise<void> =>
    transport.post(`/api/events/${encode(slug)}/photos/${encode(photoId)}/reactions`, { kind }),

  withdrawReaction: (slug: string, photoId: string, kind: ReactionKind): Promise<void> =>
    transport.del(
      `/api/events/${encode(slug)}/photos/${encode(photoId)}/reactions/${encode(kind)}`,
    ),

  reactions: (slug: string, photoId: string, signal?: AbortSignal): Promise<ReactionsResponse> =>
    transport.get(
      `/api/events/${encode(slug)}/photos/${encode(photoId)}/reactions`,
      undefined,
      signal,
    ),
})
