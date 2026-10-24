import { FakeClientRepository } from './fakeClientRepository'

/**
 * A {@link FakeClientRepository} that counts how often an event's client was looked up.
 *
 * Several use cases owe a promise about *not* reading the client: an event with no client has
 * nothing to look up, and a suspended-client check must not cost a query for an event the
 * caller may not touch. A test of "without reading the clients at all" needs the read counted
 * — `contextReads` — and it was a six-line subclass written out in six test files.
 */
export class CountingClientRepository extends FakeClientRepository {
  contextReads = 0

  override async contextForEvent(
    ...args: Parameters<FakeClientRepository['contextForEvent']>
  ): ReturnType<FakeClientRepository['contextForEvent']> {
    this.contextReads += 1
    return super.contextForEvent(...args)
  }
}
