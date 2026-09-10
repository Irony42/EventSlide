import { describe, expect, it } from 'vitest'
import {
  allowsModeration,
  isMutable,
  lifecycleActions,
  servesWall,
  statusLabel,
} from './eventLifecycle'
import { fr } from '../../lib/i18n/fr'
import type { EventStatus } from '../../lib/api/dto'

/**
 * The pins for the transcription in `eventLifecycle.ts`.
 *
 * Each expectation below is the same fact as one in
 * `src/domain/events/eventStatus.test.ts`. The web app cannot import the domain, so
 * this suite is the only thing that fails when the lifecycle moves and the admin
 * screens start offering a button the server refuses.
 */
const transitionsOf = (status: EventStatus) => lifecycleActions(status).map((action) => action.to)

describe('the transitions the admin surface offers', () => {
  it('lets a draft open to guests or be archived, and nothing else', () => {
    expect(transitionsOf('draft')).toEqual(['live', 'archived'])
  })

  // Going back to draft is not offered: guests may already hold the join link, so
  // "not started yet" would be a lie.
  it('lets a live event be closed or archived', () => {
    expect(transitionsOf('live')).toEqual(['closed', 'archived'])
  })

  // The speeches run late and the party restarts.
  it('lets a closed event reopen', () => {
    expect(transitionsOf('closed')).toEqual(['live', 'archived'])
  })

  it('offers nothing for an archived event, which is terminal', () => {
    expect(lifecycleActions('archived')).toEqual([])
  })

  it('names reopening differently from opening, because they are different moments', () => {
    expect(lifecycleActions('draft')[0]?.label).toBe(fr.admin.goLive)
    expect(lifecycleActions('closed')[0]?.label).toBe(fr.admin.reopenEvent)
  })

  it('marks at most one action as the primary one per status', () => {
    for (const status of ['draft', 'live', 'closed', 'archived'] as const) {
      expect(
        lifecycleActions(status).filter((action) => action.primary).length,
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

describe('status labels', () => {
  it('gives every status a word, so the badge is never colour alone', () => {
    expect(statusLabel('draft')).toBe(fr.admin.statusDraft)
    expect(statusLabel('live')).toBe(fr.admin.statusLive)
    expect(statusLabel('closed')).toBe(fr.admin.statusClosed)
    expect(statusLabel('archived')).toBe(fr.admin.statusArchived)
  })
})
