import { describe, expect, it } from 'vitest'
import { eventTemplateSettings } from '../events/eventTemplate'
import { EventSettings, type EventSettingsPatch } from '../events/eventSettings'
import {
  NOTICE_AUDIENCES,
  OPERATOR_NAME_MAX_LENGTH,
  privacyNoticeFor,
  type NoticePolicy,
} from './privacyNotice'

/**
 * The notice is a function of the event's settings, so every clause is tested by moving
 * the setting that decides it and watching the clause — and only that clause — follow.
 *
 * The policies are built through `EventSettings` rather than as literals, so the tests
 * also prove the real settings object satisfies `NoticePolicy`: a notice derived from a
 * hand-written literal could drift from the one production derives.
 */

/** Setup only: a patch the domain refuses is a broken test, not a rule. */
/**
 * The guestbook and the guests' save switch default to off here: new events open both, and these
 * cases are about the older clauses, whose revisions must read as they always did.
 */
const settings = (patch: EventSettingsPatch = {}): NoticePolicy => {
  const built = EventSettings.create({ allowGuestbook: false, allowGuestSave: false, ...patch })
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
  it('names the wall, the guest feed, the organisers and the shared gallery, in the order a guest reads them', () => {
    expect(privacyNoticeFor(settings()).audiences).toEqual([
      'wall',
      'guestFeed',
      'organisers',
      'sharedGallery',
    ])
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
      'publication=afterReview;audiences=wall+guestFeed+organisers+sharedGallery;retention=30;selfRemoval=900;selfErase=phone',
    )
  })

  it('reads exactly the same after spec 22 as before it, for a configuration that never changed', () => {
    // Spec 22 keeps an archive on the box that dies no later than the album: "N days" stays true, so
    // nothing may be added to what a guest reads, and nobody is asked to read it again. This is the
    // golden value of a fully loaded notice: a clause appended for the archive changes it.
    const notice = privacyNoticeFor(
      settings({
        moderation: 'auto',
        retentionDays: 90,
        guestSelfDeleteGraceSeconds: 600,
        allowGuestbook: true,
      }),
      'Atelier Camille',
    )

    expect(notice.revision).toBe(
      'publication=immediate;audiences=wall+guestFeed+organisers+sharedGallery;retention=90;selfRemoval=none;selfErase=phone;guestbook=on;operator=Atelier Camille',
    )
  })

  it('spells an absent retention and an absent window as words rather than as blanks', () => {
    const notice = privacyNoticeFor(settings({ retentionDays: null, allowGuestSelfDelete: false }))

    expect(notice.revision).toBe(
      'publication=afterReview;audiences=wall+guestFeed+organisers+sharedGallery;retention=none;selfRemoval=none;selfErase=phone',
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

describe('privacyNoticeFor — who hosts it (roadmap G2-17)', () => {
  const HOST = 'Association Les Photographes'

  it('names no operator on a box that configured none, which is every self-hosted box', () => {
    expect(privacyNoticeFor(settings()).operator).toBeNull()
    expect(privacyNoticeFor(settings(), null).operator).toBeNull()
  })

  it('names the operator the box was configured with', () => {
    expect(privacyNoticeFor(settings(), HOST).operator).toBe(HOST)
  })

  it('leaves the revision exactly as it was when no operator is named, so nobody is asked again', () => {
    // The self-hosted promise: a box that sets none of the operator keys must not see a
    // single guest shown the notice a second time because a release added a clause. The
    // string is spelled out, as in the test above, so a new clause that always prints
    // fails here and not in front of a room.
    const notice = privacyNoticeFor(
      settings({ moderation: 'manual', retentionDays: 30, guestSelfDeleteGraceSeconds: 900 }),
      null,
    )

    expect(notice.revision).toBe(
      'publication=afterReview;audiences=wall+guestFeed+organisers+sharedGallery;retention=30;selfRemoval=900;selfErase=phone',
    )
    expect(notice.revision).toBe(
      privacyNoticeFor(
        settings({ moderation: 'manual', retentionDays: 30, guestSelfDeleteGraceSeconds: 900 }),
      ).revision,
    )
  })

  it('spells the operator out at the end of the revision, so the stored value says who hosted', () => {
    const notice = privacyNoticeFor(settings({ retentionDays: 30 }), HOST)

    expect(notice.revision).toBe(
      `publication=afterReview;audiences=wall+guestFeed+organisers+sharedGallery;retention=30;selfRemoval=900;selfErase=phone;operator=${HOST}`,
    )
  })

  it('changes the revision when an operator starts to be named, so guests read who hosts them', () => {
    const before = privacyNoticeFor(settings({ retentionDays: 30 }), null)
    const after = privacyNoticeFor(settings({ retentionDays: 30 }), HOST)

    expect(after.revision).not.toBe(before.revision)
  })

  it('changes the revision when the operator changes, because another party now holds the photos', () => {
    const before = privacyNoticeFor(settings(), HOST)
    const after = privacyNoticeFor(settings(), 'Another Operator')

    expect(after.revision).not.toBe(before.revision)
  })

  it('changes the revision when the operator is withdrawn, which is a change to what the guest read', () => {
    const before = privacyNoticeFor(settings(), HOST)
    const after = privacyNoticeFor(settings(), null)

    expect(after.revision).not.toBe(before.revision)
  })

  it('keeps the longest name an operator may configure within the revision a guest can send back', () => {
    // `noticeAcknowledgementBody` caps the revision at 512; a name that pushed the revision
    // past it would answer 400 to every guest who pressed "J'ai compris", on a box whose
    // operator did nothing wrong. 512 is repeated here on purpose: the schema is in another
    // layer, and this is the number the two layers have to agree on.
    const longest = privacyNoticeFor(
      settings({
        moderation: 'manual',
        retentionDays: 3650,
        guestSelfDeleteGraceSeconds: 86_400,
        allowGuestbook: true,
        allowGuestSave: true,
      }),
      'N'.repeat(OPERATOR_NAME_MAX_LENGTH),
    )

    expect(longest.revision.length).toBeLessThan(512)
  })
})

describe('privacyNoticeFor — the guestbook (spec 01)', () => {
  it('leaves the revision exactly as it was when the guestbook is off', () => {
    const notice = privacyNoticeFor(settings({ allowGuestbook: false }))
    expect(notice.guestbook).toBe(false)
    expect(notice.revision).not.toContain('guestbook')
  })

  it('changes the revision, and says so, when the guestbook is on', () => {
    const off = privacyNoticeFor(settings({ allowGuestbook: false }))
    const on = privacyNoticeFor(settings({ allowGuestbook: true }))
    expect(on.guestbook).toBe(true)
    expect(on.revision).not.toBe(off.revision)
    expect(on.revision).toContain('guestbook=on')
  })

  it('keeps the operator as the last clause', () => {
    const notice = privacyNoticeFor(settings({ allowGuestbook: true }), 'Association X')
    expect(notice.revision.endsWith(';operator=Association X')).toBe(true)
  })
})

describe('privacyNoticeFor — the disposable camera (spec 23)', () => {
  const ON = { reveal: { enabled: true, film: true }, maxPhotosPerGuest: 27 }

  it('says nothing and keeps the revision exactly as it was when the mode is off', () => {
    const plain = privacyNoticeFor(settings())
    // Even a cap and a stored film look say nothing without the mode: an ordinary event keeps its notice.
    const capped = privacyNoticeFor(
      settings({ maxPhotosPerGuest: 27, reveal: { enabled: false, film: true } }),
    )

    expect([capped.deferredReveal, capped.shotLimit, capped.film]).toEqual([false, null, false])
    expect(capped.revision).toBe(plain.revision)
  })

  it('says the photographs are held back, the poses and the film look, once the mode is on', () => {
    const notice = privacyNoticeFor(settings(ON))

    expect([notice.deferredReveal, notice.shotLimit, notice.film]).toEqual([true, 27, true])
    expect(notice.revision).toContain('reveal=on;shots=27;film=on')
  })

  it('tells no pose count for an evening with no cap', () => {
    const notice = privacyNoticeFor(settings({ reveal: { enabled: true } }))

    expect(notice.shotLimit).toBeNull()
    expect(notice.revision).not.toContain('shots=')
  })

  it('changes the revision when the mode is switched on mid-evening: the guests read it again', () => {
    const before = privacyNoticeFor(settings())
    const after = privacyNoticeFor(settings({ reveal: { enabled: true } }))

    expect(after.revision).not.toBe(before.revision)
  })

  it('changes the revision when the number of poses changes while the mode is on', () => {
    expect(privacyNoticeFor(settings({ ...ON, maxPhotosPerGuest: 12 })).revision).not.toBe(
      privacyNoticeFor(settings(ON)).revision,
    )
  })

  it('never changes with the hour: moving it, or revealing now, asks nobody to read again', () => {
    const waiting = privacyNoticeFor(
      settings({ reveal: { enabled: true, at: new Date('2026-11-20T23:00:00Z') } }),
    )
    const later = privacyNoticeFor(
      settings({ reveal: { enabled: true, at: new Date('2026-11-21T01:00:00Z') } }),
    )
    const none = privacyNoticeFor(settings({ reveal: { enabled: true, at: null } }))
    const now = privacyNoticeFor(
      settings({ reveal: { enabled: true, at: new Date('2026-11-20T21:07:00Z') } }),
    )

    expect(new Set([waiting.revision, later.revision, none.revision, now.revision]).size).toBe(1)
  })

  it('keeps the operator as the last clause', () => {
    const notice = privacyNoticeFor(settings(ON), 'Association X')

    expect(notice.revision.endsWith(';operator=Association X')).toBe(true)
  })
})

describe('privacyNoticeFor — the guests save switch (spec 24)', () => {
  it('follows the setting: the notice says guests may save a photo exactly when the host allows it', () => {
    expect(privacyNoticeFor(settings({ allowGuestSave: true })).guestSave).toBe(true)
    expect(privacyNoticeFor(settings({ allowGuestSave: false })).guestSave).toBe(false)
  })

  it('reads character for character as before the clause existed when the switch is off', () => {
    // The golden values of the configurations an event that predates spec 24 has: that event reads
    // the switch as off, so nobody who read its notice is asked to read it again.
    expect(
      privacyNoticeFor(
        settings({ moderation: 'manual', retentionDays: 30, guestSelfDeleteGraceSeconds: 900 }),
      ).revision,
    ).toBe(
      'publication=afterReview;audiences=wall+guestFeed+organisers+sharedGallery;retention=30;selfRemoval=900;selfErase=phone',
    )
    expect(
      privacyNoticeFor(
        settings({
          moderation: 'auto',
          retentionDays: 90,
          guestSelfDeleteGraceSeconds: 600,
          allowGuestbook: true,
        }),
        'Atelier Camille',
      ).revision,
    ).toBe(
      'publication=immediate;audiences=wall+guestFeed+organisers+sharedGallery;retention=90;selfRemoval=none;selfErase=phone;guestbook=on;operator=Atelier Camille',
    )
  })

  it('adds exactly guestSave=on when the switch is on, after the guestbook and before the operator', () => {
    const off = privacyNoticeFor(settings({ allowGuestbook: true }), 'Atelier Camille')
    const on = privacyNoticeFor(
      settings({ allowGuestbook: true, allowGuestSave: true }),
      'Atelier Camille',
    )

    expect(on.revision).toBe(off.revision.replace(';operator=', ';guestSave=on;operator='))
    expect(on.revision).toContain('guestbook=on;guestSave=on;operator=Atelier Camille')
  })

  it('keeps the operator as the last clause with the switch on', () => {
    const notice = privacyNoticeFor(settings({ allowGuestSave: true }), 'Association X')

    expect(notice.revision.endsWith(';operator=Association X')).toBe(true)
  })

  it('changes the revision whichever way the switch moves, so a guest reads the other notice once', () => {
    const off = privacyNoticeFor(settings({ allowGuestSave: false }))
    const on = privacyNoticeFor(settings({ allowGuestSave: true }))

    expect(on.revision).not.toBe(off.revision)
    expect(on.revision).toBe(`${off.revision};guestSave=on`)
  })

  it('says both things together on an event where nobody may take a photo back one by one', () => {
    // The disposable-camera tension (spec 24, section 8): self-removal off, saving on. The notice
    // must not claim one and hide the other.
    const notice = privacyNoticeFor(settings({ allowGuestSelfDelete: false, allowGuestSave: true }))

    expect(notice.selfRemovalSeconds).toBeNull()
    expect(notice.guestSave).toBe(true)
  })

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])('keeps the clause when selfDelete=%s and moderation manual=%s', (selfDelete, manual) => {
    const notice = privacyNoticeFor(
      settings({
        allowGuestSelfDelete: selfDelete,
        moderation: manual ? 'manual' : 'auto',
        allowGuestSave: true,
      }),
    )

    expect(notice.guestSave).toBe(true)
    expect(notice.revision).toContain('guestSave=on')
  })
})

describe('privacyNoticeFor — voice messages (spec 25)', () => {
  /** Voice on, with the group's other keys merged in: `{ sealed: true }` keeps the switch on. */
  const voiceOn = (patch: EventSettingsPatch = {}): NoticePolicy =>
    settings({
      allowGuestbook: true,
      ...patch,
      guestbookVoice: { enabled: true, ...patch.guestbookVoice },
    })

  it('follows the setting: the notice says voice is on exactly when the host switched it on', () => {
    expect(privacyNoticeFor(voiceOn()).voice).toBe(true)
    expect(privacyNoticeFor(settings({ allowGuestbook: true })).voice).toBe(false)
  })

  it('says nothing of voice while the guestbook is closed, which voice depends on', () => {
    // The host's switch stays as they set it; it has no effect without the book (rule 13).
    const notice = privacyNoticeFor(
      settings({ allowGuestbook: false, guestbookVoice: { enabled: true, sealed: true } }),
    )

    expect(notice.voice).toBe(false)
    expect(notice.voiceSealed).toBe(false)
    expect(notice.voiceRemovalSeconds).toBeNull()
    expect(notice.revision).not.toContain('voice')
  })

  it('reads character for character as before the clause existed when voice is off', () => {
    // The golden values of the events that predate spec 25: they read the group as off, so nobody who
    // read their notice is asked to read it again. A sealed book with the switch off is still silent.
    expect(
      privacyNoticeFor(
        settings({ moderation: 'manual', retentionDays: 30, guestSelfDeleteGraceSeconds: 900 }),
      ).revision,
    ).toBe(
      'publication=afterReview;audiences=wall+guestFeed+organisers+sharedGallery;retention=30;selfRemoval=900;selfErase=phone',
    )
    expect(
      privacyNoticeFor(
        settings({
          moderation: 'auto',
          retentionDays: 90,
          guestSelfDeleteGraceSeconds: 600,
          allowGuestbook: true,
          allowGuestSave: true,
          guestbookVoice: { enabled: false, sealed: true, opensAtMs: 1_800_000_000_000 },
        }),
        'Atelier Camille',
      ).revision,
    ).toBe(
      'publication=immediate;audiences=wall+guestFeed+organisers+sharedGallery;retention=90;selfRemoval=none;selfErase=phone;guestbook=on;guestSave=on;operator=Atelier Camille',
    )
  })

  it('adds the voice clause after the guestbook and the save switch and before the operator', () => {
    const notice = privacyNoticeFor(
      voiceOn({ allowGuestSave: true, guestSelfDeleteGraceSeconds: 600 }),
      'Atelier Camille',
    )

    expect(notice.revision).toContain(
      'guestbook=on;guestSave=on;voice=on;voiceRemoval=600;operator=Atelier Camille',
    )
  })

  it('keeps the operator as the last clause with every voice sub-clause present', () => {
    const notice = privacyNoticeFor(voiceOn({ guestbookVoice: { sealed: true } }), 'Association X')

    expect(notice.revision).toContain('voice=on;voiceSealed=on;voiceRemoval=')
    expect(notice.revision.endsWith(';operator=Association X')).toBe(true)
  })

  it('changes the revision whichever way the switch moves, so a guest reads the other notice once', () => {
    const off = privacyNoticeFor(settings({ allowGuestbook: true }))
    const on = privacyNoticeFor(voiceOn())

    expect(on.revision).not.toBe(off.revision)
    expect(on.revision.startsWith(off.revision)).toBe(true)
  })

  it('changes the revision when the host starts keeping the voices secret, because the notice reads differently', () => {
    const open = privacyNoticeFor(voiceOn())
    const sealed = privacyNoticeFor(voiceOn({ guestbookVoice: { sealed: true } }))

    expect(open.voiceSealed).toBe(false)
    expect(sealed.voiceSealed).toBe(true)
    expect(sealed.revision).not.toBe(open.revision)
    expect(open.revision).not.toContain('voiceSealed')
  })

  it('answers the voice window of its own, which the photograph’s rule does not give under automatic publication', () => {
    // Rule 1 bis: a voice is never on a screen, so the author may take it back inside the window
    // whatever its status. The photograph cannot be taken back once approved, which is every photo
    // when the event publishes on arrival.
    const notice = privacyNoticeFor(
      voiceOn({ moderation: 'auto', guestSelfDeleteGraceSeconds: 600 }),
    )

    expect(notice.selfRemovalSeconds).toBeNull()
    expect(notice.voiceRemovalSeconds).toBe(600)
  })

  it('says a voice cannot be taken back when the host switched self-removal off, whatever the window', () => {
    const notice = privacyNoticeFor(voiceOn({ allowGuestSelfDelete: false }))

    expect(notice.voiceRemovalSeconds).toBeNull()
    expect(notice.revision).toContain('voiceRemoval=none')
  })

  it('says a voice cannot be taken back when the window is zero', () => {
    const notice = privacyNoticeFor(voiceOn({ guestSelfDeleteGraceSeconds: 0 }))

    expect(notice.voiceRemovalSeconds).toBeNull()
  })

  it('changes the revision when the window of a voice moves, even where the photograph’s did not', () => {
    const short = privacyNoticeFor(
      voiceOn({ moderation: 'auto', guestSelfDeleteGraceSeconds: 300 }),
    )
    const long = privacyNoticeFor(voiceOn({ moderation: 'auto', guestSelfDeleteGraceSeconds: 600 }))

    expect(short.selfRemovalSeconds).toBe(long.selfRemovalSeconds)
    expect(short.revision).not.toBe(long.revision)
  })
})

describe('privacyNoticeFor — the disposable camera and the guest save together (spec 24 section 8, Q12)', () => {
  it('the disposable template says both things: no removal one by one, and other guests may save', () => {
    const notice = privacyNoticeFor(eventTemplateSettings('disposable'))

    // The template leaves the save switch at its default (on) and turns self-removal off.
    expect(notice.selfRemovalSeconds).toBeNull()
    expect(notice.guestSave).toBe(true)
    expect(notice.deferredReveal).toBe(true)
    expect(notice.revision).toContain('selfRemoval=none')
    expect(notice.revision).toContain('guestSave=on;reveal=on;shots=27;film=on')
  })

  it.each([
    { selfDelete: true, save: true },
    { selfDelete: true, save: false },
    { selfDelete: false, save: true },
    { selfDelete: false, save: false },
  ])(
    'tells each fact on its own under the reveal gate (selfDelete=$selfDelete, save=$save)',
    ({ selfDelete, save }) => {
      const notice = privacyNoticeFor(
        settings({
          moderation: 'auto',
          allowGuestSelfDelete: selfDelete,
          allowGuestSave: save,
          reveal: { enabled: true },
        }),
      )

      expect(notice.guestSave).toBe(save)
      // Under automatic publication a photograph cannot be taken back one by one, whatever the switch.
      expect(notice.selfRemovalSeconds).toBeNull()
      expect(notice.deferredReveal).toBe(true)
      expect(notice.revision.includes('guestSave=on')).toBe(save)
      expect(notice.revision).toContain('reveal=on')
    },
  )

  it('changes nothing for an event that uses none of reveal, save or voice', () => {
    expect(privacyNoticeFor(settings({ moderation: 'manual', retentionDays: 30 })).revision).toBe(
      'publication=afterReview;audiences=wall+guestFeed+organisers+sharedGallery;retention=30;selfRemoval=900;selfErase=phone',
    )
  })

  it('puts the guest save, the reveal clauses and the voice clause in one fixed order, operator last', () => {
    const notice = privacyNoticeFor(
      settings({
        allowGuestbook: true,
        allowGuestSave: true,
        reveal: { enabled: true, film: true },
        maxPhotosPerGuest: 27,
        guestbookVoice: { enabled: true },
      }),
      'Atelier Camille',
    )

    expect(notice.revision).toContain(
      'guestbook=on;guestSave=on;reveal=on;shots=27;film=on;voice=on;voiceRemoval=',
    )
    expect(notice.revision.endsWith(';operator=Atelier Camille')).toBe(true)
  })
})

describe('privacyNoticeFor — messaging channels (spec 27)', () => {
  it('follows the host switch: the notice names Telegram exactly when it is on', () => {
    expect(privacyNoticeFor(settings({ allowTelegram: true })).channels).toEqual(['telegram'])
    expect(privacyNoticeFor(settings({ allowTelegram: false })).channels).toEqual([])
    expect(privacyNoticeFor(settings()).channels).toEqual([])
  })

  it('reads character for character as before the clause existed when no channel is connected', () => {
    // An event that predates the clause reads `allowTelegram` as off: nobody who acknowledged its notice
    // is asked to read it again.
    const before = privacyNoticeFor(settings(), 'Atelier Camille')

    expect(before.revision).not.toContain('channels')
    expect(before.revision).toBe(
      privacyNoticeFor(settings({ allowTelegram: false }), 'Atelier Camille').revision,
    )
  })

  it('changes the revision when a group is connected, so a web guest reads the notice once more', () => {
    const off = privacyNoticeFor(settings())
    const on = privacyNoticeFor(settings({ allowTelegram: true }))

    expect(on.revision).toContain('channels=telegram')
    expect(on.revision).not.toBe(off.revision)
  })

  it('puts the clause after the voice and before the operator, which stays last', () => {
    const notice = privacyNoticeFor(
      settings({ allowGuestbook: true, allowTelegram: true, guestbookVoice: { enabled: true } }),
      'Atelier Camille',
    )

    expect(notice.revision).toMatch(
      /voice=on;voiceRemoval=[^;]+;channels=telegram;operator=Atelier Camille$/,
    )
  })
})
