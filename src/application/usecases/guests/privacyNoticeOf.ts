import type { Event } from '../../../domain/events/event'
import { privacyNoticeFor, type PrivacyNotice } from '../../../domain/privacy/privacyNotice'
import type { ClientRepository } from '../../ports/clientRepository'
import { clientContextOf } from '../clients/clientContextOf'

/**
 * The privacy notice a guest of this event reads, with the retention it is **actually**
 * under (roadmap §5.1 and §10.5).
 *
 * The notice is derived from configuration, never written as prose, so that it cannot
 * promise what the configuration contradicts. For an event of a client the configuration
 * that decides retention is no longer only the host's setting: the client's
 * `max_retention_days` caps it, and "keep for ever" — what an event created before the
 * ceiling, or under a ceiling lowered since, may still say — is not what happens. So the
 * retention clause is the host's setting **clamped** by the client's ceiling, by the same
 * `ClientCeilings.clampRetention` creation and the purge use, and a notice that said
 * "never deleted" over an album the box deletes after thirty days would be exactly the
 * contradiction this module exists to prevent.
 *
 * One function for the three places a notice is built — the join, the read the upload screen
 * makes, and the acknowledgement — because they must agree to the character: a guest's
 * acknowledgement is recorded against the notice's **revision**, and a revision computed
 * from the host's number in one place and the effective one in another would ask every guest
 * to read the notice again, for ever.
 *
 * An event with no client is the notice of its own settings, exactly as before.
 *
 * **`operatorName` is required, not defaulted** (roadmap G2-17): it is the box's
 * `OPERATOR_NAME`, the same for every event, and the third thing the revision is computed
 * from. A caller that forgot it would compile and produce a revision that disagrees with the
 * other two, which is the loop above made permanent — so there is no default to forget.
 */
export const privacyNoticeOf = async (
  clients: ClientRepository,
  event: Event,
  operatorName: string | null,
): Promise<PrivacyNotice> => {
  const ceilings = (await clientContextOf(clients, event))?.ceilings ?? null
  if (ceilings === null) return privacyNoticeFor(event.settings, operatorName)

  const { settings } = event
  return privacyNoticeFor(
    {
      moderation: settings.moderation,
      retentionDays: ceilings.clampRetention(settings.retentionDays),
      allowGuestSelfDelete: settings.allowGuestSelfDelete,
      guestSelfDeleteGraceSeconds: settings.guestSelfDeleteGraceSeconds,
    },
    operatorName,
  )
}
