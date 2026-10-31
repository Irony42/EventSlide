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
 * A fixture, not the rule: the queue answers every row whatever the status filter, as the
 * static fakes did, because the console tests stage a "published" photo on the default
 * tab. `filtered` makes it honour the filter instead, as the wall strip needs: a photo taken
 * off the wall leaves it. `skip` names photos a batch refuses, which stay as they were.
 */
export const moderationServer = (
  rows: readonly ModerationPhotoDto[],
  {
    skip = [],
    filtered = false,
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
