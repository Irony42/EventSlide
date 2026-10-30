import { describe, expect, it } from 'vitest'
import {
  allowsModeration,
  canManageEvent,
  confirmationFor,
  isAfterEvening,
  isMutable,
  lifecycleActions,
  linksToWall,
  offersSupport,
  servesWall,
  statusLabel,
  transitionNotice,
} from './eventLifecycle'
import { fr } from '../../lib/i18n/fr'
import type { EventStatus } from '../../lib/api/dto'

/**
 * The pins for the transcription in `eventLifecycle.ts`.
 *
 * What the console offers is a deliberate subset of the domain's transition table (a live
 * event is not offered "archive"), so these expectations are not copies of the ones in
 * `src/domain/events/eventStatus.test.ts`, which pins the full table. The web app cannot
 * import the domain: this suite is what fails when the console's own choices change, and it
 * is read beside the domain's test when the lifecycle moves.
 */
const transitionsOf = (status: EventStatus) =>
  lifecycleActions(status, fr).map((action) => action.to)

describe('the transitions the admin surface offers', () => {
  it('lets a draft open to guests or be archived, and nothing else', () => {
    expect(transitionsOf('draft')).toEqual(['live', 'archived'])
  })

  // Going back to draft is not offered: guests may already hold the join link, so
  // "not started yet" would be a lie.
  //
  // The domain also lets a live event be archived, and this surface leaves it out on purpose:
  // archiving is terminal and sat one thumb-width from "End the evening", so the way to it is
  // to end the evening first (revue UX 30/10, HOT-4).
  it('lets a live event be ended, and not archived from beside the button that ends it', () => {
    expect(transitionsOf('live')).toEqual(['closed'])
  })

  // The speeches run late and the party restarts.
  it('lets a closed event reopen', () => {
    expect(transitionsOf('closed')).toEqual(['live', 'archived'])
  })

  it('offers nothing for an archived event, which is terminal', () => {
    expect(lifecycleActions('archived', fr)).toEqual([])
  })

  it('names reopening differently from opening, because they are different moments', () => {
    expect(lifecycleActions('draft', fr)[0]?.label).toBe(fr.admin.goLive)
    expect(lifecycleActions('closed', fr)[0]?.label).toBe(fr.admin.reopenEvent)
  })

  it('marks at most one action as the primary one per status', () => {
    for (const status of ['draft', 'live', 'closed', 'archived'] as const) {
      expect(
        lifecycleActions(status, fr).filter((action) => action.primary).length,
      ).toBeLessThanOrEqual(1)
    }
  })
})

describe('what each status still allows', () => {
  it('keeps moderation open until the event is archived', () => {
    expect(allowsModeration('draft')).toBe(true)
    expect(allowsModeration('live')).toBe(true)
    expect(allowsModeration('closed')).toBe(true)
    expect(allowsModeration('archived')).toBe(false)
  })

  // A closed event keeps playing — the projector is usually still on while people say
  // goodbye — but a draft has nothing to show and an archived one is put away.
  it('serves the wall while live or closed', () => {
    expect(servesWall('draft')).toBe(false)
    expect(servesWall('live')).toBe(true)
    expect(servesWall('closed')).toBe(true)
    expect(servesWall('archived')).toBe(false)
  })

  it('freezes settings, name and join code once archived', () => {
    expect(isMutable('live')).toBe(true)
    expect(isMutable('archived')).toBe(false)
  })
})

describe('when the support mention may be offered', () => {
  // Presentation only: there is nothing in the domain to mirror. The moment is "after the
  // event is closed" (roadmap G4-02), when the host is least likely to be mid-task.
  it('is the closed event and no other state', () => {
    expect(offersSupport('draft')).toBe(false)
    expect(offersSupport('live')).toBe(false)
    expect(offersSupport('closed')).toBe(true)
    expect(offersSupport('archived')).toBe(false)
  })
})

describe('status labels', () => {
  it('gives every status a word, so the badge is never colour alone', () => {
    expect(statusLabel('draft', fr)).toBe(fr.admin.statusDraft)
    expect(statusLabel('live', fr)).toBe(fr.admin.statusLive)
    expect(statusLabel('closed', fr)).toBe(fr.admin.statusClosed)
    expect(statusLabel('archived', fr)).toBe(fr.admin.statusArchived)
  })
})

describe('which moves ask first', () => {
  // Terminal: the screen stops, the settings freeze, nothing brings it back.
  it('always asks before archiving, from any state that offers it', () => {
    expect(confirmationFor('draft', 'archived')).toBe('archive')
    expect(confirmationFor('live', 'archived')).toBe('archive')
    expect(confirmationFor('closed', 'archived')).toBe('archive')
  })

  // There is no way back to "not started yet" once guests hold the link.
  it('asks once, lightly, before opening a draft to guests', () => {
    expect(confirmationFor('draft', 'live')).toBe('open')
  })

  it('lets ending the evening and reopening it go through, since each undoes the other', () => {
    expect(confirmationFor('live', 'closed')).toBeNull()
    expect(confirmationFor('closed', 'live')).toBeNull()
  })
})

describe('the toast of each move', () => {
  it('says something different for opening, ending, reopening and archiving', () => {
    const notices = [
      transitionNotice('draft', 'live', fr),
      transitionNotice('live', 'closed', fr),
      transitionNotice('closed', 'live', fr),
      transitionNotice('closed', 'archived', fr),
    ]
    expect(new Set(notices).size).toBe(4)
    expect(notices).toEqual([
      fr.admin.noticeOpened,
      fr.admin.noticeClosed,
      fr.admin.noticeReopened,
      fr.admin.noticeArchived,
    ])
  })
})

describe('the toast of archiving a draft', () => {
  // Nothing ever ran in a draft, so "the album stays downloadable" would be about nothing.
  it('does not promise an album when the archived event never began', () => {
    expect(transitionNotice('draft', 'archived', fr)).toBe(fr.admin.noticeArchivedDraft)
    expect(transitionNotice('closed', 'archived', fr)).toBe(fr.admin.noticeArchived)
  })
})

describe('what the page leads with, and what it links to', () => {
  // The projector is plugged in before the doors open: a draft links to the wall, which waits.
  it('links to the wall from the draft on, and not once the event is archived', () => {
    expect(linksToWall('draft')).toBe(true)
    expect(linksToWall('live')).toBe(true)
    expect(linksToWall('closed')).toBe(true)
    expect(linksToWall('archived')).toBe(false)
  })

  it('treats a closed and an archived event as the evening being over', () => {
    expect(isAfterEvening('draft')).toBe(false)
    expect(isAfterEvening('live')).toBe(false)
    expect(isAfterEvening('closed')).toBe(true)
    expect(isAfterEvening('archived')).toBe(true)
  })
})

describe('who may change the lifecycle', () => {
  // The same fact as `capabilities by role` in `src/domain/events/eventRole.test.ts`: the host's
  // own decisions are the owner's, and a moderator exists to approve photographs and nothing else.
  it('is the owner’s alone, as the domain says', () => {
    expect(canManageEvent('owner')).toBe(true)
    expect(canManageEvent('moderator')).toBe(false)
  })
})
