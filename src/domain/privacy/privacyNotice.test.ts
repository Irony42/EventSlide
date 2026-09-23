import { describe, expect, it } from 'vitest'
import { EventSettings, type EventSettingsPatch } from '../events/eventSettings'
import { NOTICE_AUDIENCES, privacyNoticeFor, type NoticePolicy } from './privacyNotice'

/**
 * The notice is a function of the event's settings, so every clause is tested by moving
 * the setting that decides it and watching the clause — and only that clause — follow.
 *
 * The policies are built through `EventSettings` rather than as literals, so the tests
 * also prove the real settings object satisfies `NoticePolicy`: a notice derived from a
 * hand-written literal could drift from the one production derives.
 */

/** Setup only: a patch the domain refuses is a broken test, not a rule. */
const settings = (patch: EventSettingsPatch = {}): NoticePolicy => {
  const built = EventSettings.create(patch)
  if (!built.ok) throw new Error(`test setup: ${built.error.code}`)
  return built.value
}

describe('privacyNoticeFor — what happens to a photo', () => {
  it('says a person decides before the wall when the host moderates by hand', () => {
    expect(privacyNoticeFor(settings({ moderation: 'manual' })).publication).toBe('afterReview')
  })

  it('says a photo goes straight to the wall when the event publishes on arrival', () => {
    expect(privacyNoticeFor(settings({ moderation: 'auto' })).publication).toBe('immediate')
  })

  it('promises a review by default, because the default event moderates by hand', () => {
    expect(privacyNoticeFor(settings()).publication).toBe('afterReview')
  })
})

describe('privacyNoticeFor — who sees it', () => {
  it('names the wall, the organisers and the shared gallery, in the order a guest reads them', () => {
    expect(privacyNoticeFor(settings()).audiences).toEqual(['wall', 'organisers', 'sharedGallery'])
  })

  it.each<[string, EventSettingsPatch]>([
    ['moderated by hand', { moderation: 'manual' }],
    ['publishing on arrival', { moderation: 'auto' }],
    ['keeping the album', { retentionDays: null }],
    ['deleting it after a week', { retentionDays: 7 }],
    ['with no self-delete', { allowGuestSelfDelete: false }],
  ])(
    'tells a guest the host may share the album on an event %s, since a link can come after their last photo',
    (_label, patch) => {
      expect(privacyNoticeFor(settings(patch)).audiences).toContain('sharedGallery')
    },
  )

  it('hands out a copy, so a caller cannot change the audiences of the next notice', () => {
    const notice = privacyNoticeFor(settings())

    expect(notice.audiences).not.toBe(NOTICE_AUDIENCES)
  })
})

describe('privacyNoticeFor — how long it is kept', () => {
  it('states the retention period the host configured', () => {
    expect(privacyNoticeFor(settings({ retentionDays: 30 })).retentionDays).toBe(30)
  })

  it('says nothing deletes the album on its own when retention is off', () => {
    expect(privacyNoticeFor(settings({ retentionDays: null })).retentionDays).toBeNull()
  })

  it('states no automatic deletion by default, which is what the default event does', () => {
    expect(privacyNoticeFor(settings()).retentionDays).toBeNull()
  })
})

describe('privacyNoticeFor — how to have it removed', () => {
  it('offers the self-delete window the host configured on a moderated event', () => {
    const notice = privacyNoticeFor(
      settings({
        moderation: 'manual',
        allowGuestSelfDelete: true,
        guestSelfDeleteGraceSeconds: 900,
      }),
    )

    expect(notice.selfRemovalSeconds).toBe(900)
  })

  it('offers no window when the host turned self-deletion off', () => {
    const notice = privacyNoticeFor(
      settings({ allowGuestSelfDelete: false, guestSelfDeleteGraceSeconds: 900 }),
    )

    expect(notice.selfRemovalSeconds).toBeNull()
  })

  it('offers no window when the window is zero, which switches it off', () => {
    const notice = privacyNoticeFor(
      settings({ allowGuestSelfDelete: true, guestSelfDeleteGraceSeconds: 0 }),
    )

    expect(notice.selfRemovalSeconds).toBeNull()
  })

  it('offers no window on an event that publishes on arrival, where no photo is ever off the wall to take back', () => {
    // `Photo.canBeDeletedBy` refuses a guest once their photo is published, and under
    // `auto` it is published on ingest. A window promised here is a delete button the
    // server answers with 403 — the contradiction this module exists to rule out.
    const notice = privacyNoticeFor(
      settings({
        moderation: 'auto',
        allowGuestSelfDelete: true,
        guestSelfDeleteGraceSeconds: 900,
      }),
    )

    expect(notice.selfRemovalSeconds).toBeNull()
  })
})

describe('privacyNoticeFor — the revision', () => {
  it('is the same for two events configured alike', () => {
    const one = privacyNoticeFor(settings({ retentionDays: 30 }))
    const other = privacyNoticeFor(settings({ retentionDays: 30 }))

    expect(one.revision).toBe(other.revision)
  })

  it('spells out every clause, so the stored value says what the guest was told', () => {
    const notice = privacyNoticeFor(
      settings({ moderation: 'manual', retentionDays: 30, guestSelfDeleteGraceSeconds: 900 }),
    )

    expect(notice.revision).toBe(
      'publication=afterReview;audiences=wall+organisers+sharedGallery;retention=30;selfRemoval=900',
    )
  })

  it('spells an absent retention and an absent window as words rather than as blanks', () => {
    const notice = privacyNoticeFor(settings({ retentionDays: null, allowGuestSelfDelete: false }))

    expect(notice.revision).toBe(
      'publication=afterReview;audiences=wall+organisers+sharedGallery;retention=none;selfRemoval=none',
    )
  })

  it.each<[rule: string, patch: EventSettingsPatch]>([
    ['moderation', { moderation: 'auto' }],
    ['the retention period', { retentionDays: 7 }],
    ['turning retention off', { retentionDays: null }],
    ['the self-delete window', { guestSelfDeleteGraceSeconds: 300 }],
    ['turning self-deletion off', { allowGuestSelfDelete: false }],
  ])('changes when the host changes %s', (_rule, patch) => {
    const before = privacyNoticeFor(settings({ retentionDays: 30 }))
    const after = privacyNoticeFor(settings({ retentionDays: 30, ...patch }))

    expect(after.revision).not.toBe(before.revision)
  })

  it.each<[rule: string, patch: EventSettingsPatch]>([
    ['captions', { allowCaptions: false }],
    ['reactions', { allowReactions: false }],
    ['video clips', { allowClips: false }],
    ['the per-guest cap', { maxPhotosPerGuest: 20 }],
    ['the wall language', { wallLanguage: 'en' }],
  ])(
    'stays the same when the host changes %s, which changes nothing about a photo',
    (_rule, patch) => {
      // Re-asking a guest over a setting their photo never meets would teach them that
      // the notice changes for no reason, which is how a notice stops being read.
      const before = privacyNoticeFor(settings({ retentionDays: 30 }))
      const after = privacyNoticeFor(settings({ retentionDays: 30, ...patch }))

      expect(after.revision).toBe(before.revision)
    },
  )

  it('stays the same when a window change cannot reach the guest, because the event publishes on arrival', () => {
    // The window is not in the notice under `auto`, so moving it changes no sentence —
    // and "reads differently" is the only definition of material this module has.
    const before = privacyNoticeFor(
      settings({ moderation: 'auto', guestSelfDeleteGraceSeconds: 900 }),
    )
    const after = privacyNoticeFor(
      settings({ moderation: 'auto', guestSelfDeleteGraceSeconds: 300 }),
    )

    expect(after.revision).toBe(before.revision)
  })
})
