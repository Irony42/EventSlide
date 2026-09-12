import { beforeEach, describe, expect, it } from 'vitest'
import type { EventStatus } from '../../../domain/events/eventStatus'
import { asEventId } from '../../../domain/shared/ids'
import { anEvent } from '../../testing/builders'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { makeResolveJoinCode, type ResolveJoinCode } from './resolveJoinCode'

const WEDDING = asEventId('evt-wedding')
/** Contains a zero, so the confusable cases below have something to fold onto. */
const WEDDING_CODE = 'H0K2QM'

describe('resolveJoinCode', () => {
  let events: FakeEventRepository
  let resolveJoinCode: ResolveJoinCode

  beforeEach(() => {
    events = new FakeEventRepository()
    resolveJoinCode = makeResolveJoinCode({ events })
  })

  const seedWedding = (status: EventStatus = 'live'): void => {
    events.seed(
      anEvent({
        id: WEDDING,
        name: 'Camille & Sacha',
        slug: 'camille-et-sacha',
        joinCode: WEDDING_CODE,
        status,
        ownerId: 'user-host',
        quotaBytes: 12_345,
      }),
    )
  }

  /**
   * Asserted as a whole object rather than field by field: the point of this shape is
   * everything it does *not* contain. The owner, the quota and the id are all set on
   * the fixture, and a use case that started returning one would fail here.
   */
  it('answers with what a guest may know before joining, and nothing else', async () => {
    seedWedding()

    const result = await resolveJoinCode({ code: WEDDING_CODE })

    expect(result.ok && result.value).toEqual({
      slug: 'camille-et-sacha',
      name: 'Camille & Sacha',
      acceptsGuests: true,
      allowCaptions: true,
      allowReactions: true,
    })
  })

  it('reports the caption and reaction policy the host chose', async () => {
    events.seed(
      anEvent({
        id: WEDDING,
        joinCode: WEDDING_CODE,
        settings: { allowCaptions: false, allowReactions: false },
      }),
    )

    const result = await resolveJoinCode({ code: WEDDING_CODE })

    expect(result.ok && result.value).toMatchObject({
      allowCaptions: false,
      allowReactions: false,
    })
  })

  /**
   * The card is read off a table in a dark room and typed on a phone keyboard: nothing
   * capitalises, separators are decoration, and `O` and `0` are the same glyph in most
   * fonts. Every one of these has to reach the wedding.
   */
  it.each([
    { typed: 'lowercase', code: 'h0k2qm' },
    { typed: 'dash-separated, as printed', code: 'H0K2-QM' },
    { typed: 'with an O for the digit zero', code: 'HOK2QM' },
    { typed: 'with the spaces of a clumsy paste', code: ' h0k2 qm ' },
  ])('resolves a code typed $typed', async ({ code }) => {
    seedWedding()

    const result = await resolveJoinCode({ code })

    expect(result.ok && result.value.name).toBe('Camille & Sacha')
  })

  // ------------------------------------------------------------ the closed door --

  it('answers event.notFound for a code no event holds', async () => {
    const result = await resolveJoinCode({ code: 'Z9Z9Z9' })

    expect(!result.ok && result.error.code).toBe('event.notFound')
  })

  /**
   * The same answer as an unknown code, deliberately. This is the one lookup an
   * attacker can enumerate with nothing but a printed six-character credential, and a
   * distinguishable "not open yet" would confirm which codes belong to real events.
   */
  it.each<EventStatus>(['draft', 'closed', 'archived'])(
    'answers a %s event with event.notFound, indistinguishable from a wrong code',
    async (status) => {
      seedWedding(status)

      const result = await resolveJoinCode({ code: WEDDING_CODE })

      expect(!result.ok && result.error.code).toBe('event.notFound')
    },
  )

  it('answers a draft event with a notFound kind, so the wire status is a 404 too', async () => {
    seedWedding('draft')

    const result = await resolveJoinCode({ code: WEDDING_CODE })

    expect(!result.ok && result.error.kind).toBe('notFound')
  })

  it('refuses a closed event without detailing the event behind the code', async () => {
    seedWedding('closed')

    const result = await resolveJoinCode({ code: WEDDING_CODE })

    expect(!result.ok && result.error.details).toEqual({})
  })

  /**
   * The *shape* of a code is safe to report: it tells a guest to count the characters
   * again, and a string that could never be stored says nothing about the codes that are.
   */
  it('reports a code of the wrong length without touching the repository', async () => {
    const result = await resolveJoinCode({ code: 'H0K2Q' })

    expect(!result.ok && result.error.code).toBe('joinCode.wrongLength')
  })

  it('reports a code carrying characters the alphabet excludes', async () => {
    const result = await resolveJoinCode({ code: 'H0K2Q@' })

    expect(!result.ok && result.error.code).toBe('joinCode.malformed')
  })
})
