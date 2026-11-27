import type { AccountChangeKind } from '../../domain/mail/accountChangeMail'
import type { UserId } from '../../domain/shared/ids'
import type { AccountNoticeHook } from '../usecases/notices/accountNotice'

/**
 * An `AccountNoticeHook` that only writes down what it was asked, in order, so a use case's test reads
 * "told after the write, once, with this kind" without a mailer. `events` interleaves what the use case did
 * to the notice, for the one test that needs the order (the address is read before an erasure, the mail goes
 * after it).
 */
export class RecordingAccountNotice implements AccountNoticeHook {
  /** `notify` calls and `send` calls of a prepared notice, in order. */
  readonly events: string[] = []

  get notified(): readonly { readonly userId: UserId; readonly kind: AccountChangeKind }[] {
    return this.calls
  }

  private readonly calls: { userId: UserId; kind: AccountChangeKind }[] = []

  notify(userId: UserId, kind: AccountChangeKind): void {
    this.calls.push({ userId, kind })
    this.events.push(`notify:${kind}`)
  }

  async prepare(userId: UserId, kind: AccountChangeKind): Promise<{ send(): void }> {
    this.events.push(`prepare:${kind}`)
    return {
      send: () => {
        this.calls.push({ userId, kind })
        this.events.push(`send:${kind}`)
      },
    }
  }
}
