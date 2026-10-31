import { vi } from 'vitest'
import { aModerationPhoto } from '../../../testing/renderWithProviders'
import type { Api } from '../../../lib/api/client'
import type {
  BulkModerationResponse,
  ModerationDecision,
  ModerationPhotoDto,
  PhotoStatus,
} from '../../../lib/api/dto'

const STATUS_AFTER: Readonly<Record<ModerationDecision, PhotoStatus>> = {
  publish: 'published',
  reject: 'rejected',
  hide: 'hidden',
}

/**
 * The moderation endpoints of a server that remembers what it was told.
 *
 * The console confirms every decision with a silent refetch (nothing waits for a stream
 * signal, because a venue's network takes the stream away first), so a fake whose queue
 * never changes tells the console the decision did not happen. This one applies each
 * decision to its rows and answers the next read with them, `allowedDecisions` included,
 * which is what the real endpoint does.
 *
 * The queue honours the status filter, as the real endpoint does: a photo that has just been
 * decided leaves the "en attente" tab once the next read answers, and a photo taken off the
 * wall leaves the strip. A test that stages a photo whose status is not the tab's (a
 * "published" photo on the default tab) passes `filtered: false` to have every row
 * answered whatever the filter, and says why. `skip` names photos a batch refuses, which
 * stay as they were.
 */
export const moderationServer = (
  rows: readonly ModerationPhotoDto[],
  {
    skip = [],
    filtered = true,
  }: { readonly skip?: readonly string[]; readonly filtered?: boolean } = {},
): Pick<Api, 'moderationQueue' | 'moderate' | 'moderateBulk'> => {
  let current = [...rows]

  const apply = (id: string, decision: ModerationDecision): boolean => {
    const row = current.find((candidate) => candidate.id === id)
    if (row === undefined) return false
    const status = STATUS_AFTER[decision]
    current = current.map((candidate) =>
      candidate.id === id
        ? { ...row, status, allowedDecisions: aModerationPhoto({ status }).allowedDecisions }
        : candidate,
    )
    return true
  }

  return {
    moderationQueue: vi.fn(
      async (_slug: string, query?: { readonly status?: PhotoStatus | 'all' }) => ({
        items:
          filtered && query?.status !== undefined && query.status !== 'all'
            ? current.filter((row) => row.status === query.status)
            : current,
        pendingCount: current.filter((row) => row.status === 'pending').length,
        nextCursor: null,
      }),
    ),
    moderate: vi.fn(async (_slug: string, id: string, decision: ModerationDecision) => {
      apply(id, decision)
    }),
    moderateBulk: vi.fn(
      async (
        _slug: string,
        ids: readonly string[],
        decision: ModerationDecision,
      ): Promise<BulkModerationResponse> => {
        const applied: string[] = []
        const skipped: string[] = []
        for (const id of ids) {
          if (!skip.includes(id) && apply(id, decision)) applied.push(id)
          else skipped.push(id)
        }
        return { applied, skipped }
      },
    ),
  }
}

/** A settled-by-hand promise: the test releases an answer when it chooses to. */
export interface Hold {
  readonly promise: Promise<void>
  /** Let the held answer through. */
  readonly settle: () => void
}

/**
 * The same server, whose answers a test releases by hand.
 *
 * A read answers with the rows as they were when it was asked, and then waits: that is what
 * a slow response looks like from the console, a snapshot of a moment that has passed.
 * `hold('read')` makes the next read wait, `hold('moderate')` the next decision (single or
 * bulk), whose effect on the rows lands only when it is released. Holds are taken in the
 * order they were made, one per request.
 */
export const heldModerationServer = (
  rows: readonly ModerationPhotoDto[],
  options?: Parameters<typeof moderationServer>[1],
) => {
  const server = moderationServer(rows, options)
  const holds: Record<'read' | 'moderate', Hold[]> = { read: [], moderate: [] }
  const endpoints: Pick<Api, 'moderationQueue' | 'moderate' | 'moderateBulk'> = {
    moderationQueue: vi.fn(async (...args: Parameters<Api['moderationQueue']>) => {
      const answer = await server.moderationQueue(...args)
      await holds.read.shift()?.promise
      return answer
    }),
    moderate: vi.fn(async (...args: Parameters<Api['moderate']>) => {
      await holds.moderate.shift()?.promise
      return server.moderate(...args)
    }),
    moderateBulk: vi.fn(async (...args: Parameters<Api['moderateBulk']>) => {
      await holds.moderate.shift()?.promise
      return server.moderateBulk(...args)
    }),
  }
  const hold = (kind: 'read' | 'moderate'): Hold => {
    let settle: () => void = () => {}
    const promise = new Promise<void>((resolve) => {
      settle = resolve
    })
    const next: Hold = { promise, settle }
    holds[kind].push(next)
    return next
  }
  return { endpoints, hold }
}
