// What the projected wall is sent.
import type {
  ClipJobStatus,
  EventBrandDto,
  EventLanguage,
  EventThemeDto,
  MediaKind,
  MissionScope,
  WallLayout,
} from './common'

/**
 * One row of the wall's playlist.
 *
 * The three clip fields are `null`-valued on a photograph rather than absent, so nothing
 * here tests for a missing key. `displayUrl` and `thumbUrl` point at a clip's **poster**,
 * which is what lets the four layouts that do not play video render one with no branch of
 * their own — see `wallLayoutPlayback.ts` for which two do.
 */
export interface WallItemDto {
  readonly id: string
  readonly displayUrl: string
  readonly thumbUrl: string
  readonly width: number
  readonly height: number
  readonly caption: string | null
  readonly authorName: string | null
  readonly createdAt: string
  /**
   * The first photograph this named sender has on the wall: the slide adds "Première photo
   * de …" the first time it is shown. Optional, like `theme` below: a server build that
   * predates it leaves the caption as it was.
   */
  readonly firstFromGuest?: boolean
  readonly kind: MediaKind
  /** `null` for a photograph. The mp4, which answers `Range` requests. */
  readonly videoUrl: string | null
  /** `null` for a photograph. Milliseconds, measured on the stored file. */
  readonly durationMs: number | null
}
/**
 * What a guest is told about a clip that has no photo row yet.
 *
 * It exists because that window is real: between the upload and the transcode there is
 * nothing in "Vos envois" to show them, and a guest who cannot tell whether it worked
 * sends the video again. `photoId` names the row the job will produce and is present
 * whatever the status, so the client can start watching for it immediately — it names an
 * existing photo only once `status` is `done`.
 */
export interface ClipJobDto {
  readonly clipJobId: string
  readonly status: ClipJobStatus
  readonly photoId: string
  /** The stable code behind a `failed` status; the client picks its sentence from it. */
  readonly failureCode: string | null
}
export interface WallResponse {
  readonly event: { readonly slug: string; readonly name: string }
  /**
   * The join code, because the wall doubles as the invitation while it is empty
   * (DESIGN-SYSTEM.md section 10) and someone arriving at 23:00 has only the screen to
   * read. Optional: a server build that does not present it yet leaves the projector
   * showing the invitation without a code rather than crashing it.
   */
  readonly joinCode?: string
  /**
   * The absolute link the QR encodes, built by the server from `PUBLIC_URL`.
   *
   * Never rebuilt here from `window.location.origin`, which is what this used to do: that
   * is the address the *projector* was opened on, and a wall on the venue's LAN then
   * printed a QR no guest's phone could resolve. The server knows the address a phone can
   * reach; the screen does not.
   *
   * Optional for the same reason `joinCode` is — a server build that predates the field
   * must not crash the projector. The wall then shows no join block at all rather than
   * falling back to its own origin: no QR is a gap a host can work around with the printed
   * cards, and a QR pointing somewhere wrong is a guest's evening lost in silence.
   */
  readonly joinUrl?: string
  /**
   * Whether the room may still be invited to send photos — true only while the event is
   * live. False once the host has closed it: the wall keeps playing, but the QR, the code
   * and the missions come off it, because every one of them asks for a photo that can no
   * longer be sent.
   *
   * Optional for the reason `joinCode` is: a server build that predates the field must not
   * crash the projector, and it reads as "still open", which is how that wall behaved.
   */
  readonly acceptsGuests?: boolean
  /** Order-sensitive fingerprint of `items`; unchanged means the playlist did not move. */
  readonly revision: string
  readonly items: readonly WallItemDto[]
  readonly slideIntervalMs: number
  readonly kenBurnsDurationMs: number
  /** The effective layout: the event's choice if it made one, else the default (spec 13). */
  readonly layout: WallLayout
  /** Whether `layout` is the host's choice for the event. Optional: an older server sends none. */
  readonly layoutChosen?: boolean
  /**
   * The mixed wall's schedule, or `null` when it is off: a wall that has not been asked to
   * alternate says nothing about it. `layout` is the "wall" phase's (the other phase is
   * always `spotlight`).
   */
  readonly mixed?: {
    readonly wallMs: number
    readonly slideshowMs: number
    readonly layout: WallLayout
    readonly anchorMs: number
  } | null
  /** The souvenirs visible on the wall (spec 11); `null` when neither switch below is on. */
  readonly souvenirCount?: number | null
  readonly souvenirCounter?: boolean
  readonly newPhotoSignal?: boolean
  /** Optional: an older server sends none, and the wall then behaves as before (true). */
  readonly freshLane?: boolean
  readonly tilt?: boolean
  readonly showTime?: boolean
  /**
   * The invitation card (spec 14): shown on a populated wall, its scale (0.8 to 1.5, 1 = as it
   * always was) and corner. Optional: an older server sends none and the wall takes the defaults.
   */
  readonly joinCard?: {
    readonly visible: boolean
    readonly scale: number
    readonly placement: 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start'
  }
  /**
   * The sound the wall may play for a new photo (spec 12). Optional: an older server sends none
   * and the wall stays silent.
   */
  readonly sound?: {
    readonly enabled: boolean
    readonly tone: 'bell' | 'chime' | 'drop' | 'pop'
    readonly volume: number
  }
  readonly reactionsEnabled: boolean
  /**
   * What the room is meant to look like.
   *
   * On this response rather than behind a second request, so the wall never paints a
   * frame in the product's colours and then repaints in the host's — a projector that
   * blinks on every reload is a defect the room notices.
   *
   * Optional, like `joinCode` above and for the same reason: a server build that predates
   * theming leaves the projector on the default look rather than crashing it.
   */
  readonly theme?: EventThemeDto
  /** The host's welcome message (spec 03). Optional: a server build that predates it sends none. */
  readonly brand?: EventBrandDto
  /**
   * The host's prompts and how the room is answering them (roadmap §2.1).
   *
   * On this response rather than behind a second request, for the reason the theme is: a
   * projector runs unattended, and one fetch that either arrives or does not beats two
   * that can half-arrive. It is also what keeps the panel current without polling — the
   * wall refetches this whole response on every signal on the event's channel.
   *
   * Optional, like `theme` and `joinCode` above: a server build that predates missions
   * leaves the projector drawing no panel rather than crashing it. **An empty array
   * means the same thing**, and is what nearly every event sends.
   */
  readonly missions?: readonly WallMissionDto[]
  /**
   * The server's clock at this read, in milliseconds (spec 10; spec 09 shares the field): the
   * anchor of every countdown on the wall. Optional: an older server leaves the projector with no
   * challenge rather than crashing it.
   */
  readonly serverNowMs?: number
  /** The running challenge, or the one that just ended; `null` or absent otherwise (spec 10). */
  readonly challenge?: WallChallengeDto | null
  /** The guestbook for the room (spec 01); absent when there is nothing to show or an older server. */
  readonly guestbook?: WallGuestbookDto
  /**
   * The language this screen renders its own words in (roadmap 1.5).
   *
   * Optional here and required on the server, which is not an inconsistency: this is the
   * client's reading of a wire it does not control, and a projector left open across a
   * rollback must render French rather than crash. `WallPage` narrows it through
   * `parseLocale`, so a tag this build has no table for takes the same path as an absent
   * one.
   */
  readonly wallLanguage?: EventLanguage
}
/**
 * One prompt as the room sees it.
 *
 * `scope` is the only field that changes a pixel here: a once-for-the-evening prompt is
 * drawn with a tick, a per-guest one with `completedByGuests`, because a tick would be
 * wrong for something two hundred people can each answer.
 */
export interface WallGuestbookMessageDto {
  readonly id: string
  readonly text: string
  readonly authorName: string | null
  readonly displayMs: number
}
export interface WallGuestbookDto {
  readonly everyNth: number
  readonly messages: readonly WallGuestbookMessageDto[]
}
export interface WallMissionDto {
  readonly id: string
  readonly prompt: string
  readonly scope: MissionScope
  readonly achieved: boolean
  readonly completedByGuests: number
}
/**
 * The timed challenge as the wall reads it (spec 10): the frozen prompt, two instants, a state,
 * and **a count of published answers once it is over** (`null` while it runs, or when nobody
 * answered). No name, no guest id, no photograph.
 */
export interface WallChallengeDto {
  readonly id: string
  readonly prompt: string
  readonly startedAt: string
  readonly endsAt: string
  readonly state: 'running' | 'ended'
  readonly answers: number | null
}
