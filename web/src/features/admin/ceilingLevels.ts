import type { About, CeilingMeterDto, ClientLimitsDto } from '../../lib/api/dto'

/**
 * What the banner over a client's ceilings is made of (roadmap §10.5; G2-16 / P3-17).
 *
 * **The thresholds are not here.** The server decides `ok`, `warning` (from 90 per cent) and
 * `reached` (100) once, in `ceilingLevel` (`src/domain/clients/ceilingUsage.ts`), and sends the
 * level beside the figures, so a number on a screen and the line it is judged against cannot
 * be two opinions. All this module does is choose what to show of what it was told.
 */

export type BannerLevel = 'warning' | 'reached'

/**
 * The meters a client should be told about: those at or past the line, and none below it. A
 * client at 89 per cent is shown nothing, and one at 90 per cent is shown that meter alone.
 */
export const noticeableMeters = (limits: ClientLimitsDto): readonly CeilingMeterDto[] =>
  limits.meters.filter((meter) => meter.level !== 'ok')

/**
 * The banner's level, or `null` when there is nothing to say: the worst of the noticeable
 * meters, and `reached` when the operator has paused the opening of events altogether
 * (`liveAllowed = false`), which stops the client as surely as a full ceiling does.
 */
export const bannerLevel = (limits: ClientLimitsDto): BannerLevel | null => {
  if (!limits.ceilings.liveAllowed) return 'reached'
  const noticeable = noticeableMeters(limits)
  if (noticeable.some((meter) => meter.level === 'reached')) return 'reached'
  return noticeable.length > 0 ? 'warning' : null
}

/** Where a client who has hit a limit is sent: the operator's own contact address, or nowhere. */
export interface ContactAction {
  readonly href: string
}

/**
 * The call to action of the banner and of the suspension screen: **"contact your operator"**,
 * as a link to the address the operator published (`OPERATOR_CONTACT_EMAIL`, already shaped by
 * `useAbout` into one plain address that `mailto:` can carry), or `null` when the box published
 * none, in which case the screens say it in words and link nowhere.
 *
 * An upgrade address (`links.upgrade`) is the paid plan's, and no box here publishes one.
 */
export const contactActionOf = (about: About): ContactAction | null =>
  about.operator?.contactEmail === undefined
    ? null
    : { href: `mailto:${about.operator.contactEmail}` }
