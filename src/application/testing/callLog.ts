/**
 * A call-order recorder for the port doubles.
 *
 * A handful of rules in this codebase are about **the order two side effects happen
 * in**, and about nothing else: the committed state is identical either way, which is
 * exactly why a test that asserts on state cannot see them. Two of them are
 * load-bearing, and both say the same sentence — *the bytes go before the row* —
 * because the row is what holds the digest in the partial unique index:
 *
 * - `uploadClip.releaseReservation`: `media.delete` then `clips.deleteForPhoto`;
 * - `transcodeNextClip.giveUpOn`: `discard` then `clips.save`.
 *
 * Swapping either one was green across the whole suite, and the cost is a guest's video.
 * A `failed` row deliberately does not block re-upload, so a guest whose clip was given
 * up on sends it again straight away; their fresh reservation holds the digest; the old
 * pass then unlinks the source under it; the new job goes `queued` pointing at nothing,
 * and `clip.sourceMissing` is permanent. Every later attempt dedupes onto the dead row.
 *
 * So this wraps a double rather than replacing it. Every call is really made, against
 * the real fake, and the order is written down on the way past — which keeps
 * `docs/TESTING.md` §3 intact in the way that matters. The assertion is still about
 * something the caller observes, not about a private helper: for an ordering rule, the
 * sequence of calls **is** the rule.
 *
 * One mechanism rather than a spy per rule, because the next ordering rule will want the
 * same thing and a bespoke spy is a rule with one spelling per site.
 *
 * ```ts
 * const calls = new CallLog()
 * media = calls.watch('media', media)
 * clips = calls.watch('clips', clips)
 * build()
 *
 * await transcodeNextClip()
 *
 * expect(calls.sequenceOf('media.delete', 'clips.save')).toEqual([
 *   'media.delete',
 *   'clips.save',
 * ])
 * ```
 */
export class CallLog {
  private readonly entries: string[] = []

  /** Every call made on a watched double, in order, as `target.method`. */
  get names(): readonly string[] {
    return [...this.entries]
  }

  /**
   * Only the named calls, in the order they were actually made.
   *
   * The filter is the point: a use case makes dozens of calls and an ordering rule is
   * about two of them, so a test names its two and reads back what happened between
   * them — which fails on a swap and stays quiet when an unrelated call is added.
   */
  sequenceOf(...names: readonly string[]): readonly string[] {
    const wanted = new Set(names)
    return this.entries.filter((entry) => wanted.has(entry))
  }

  /**
   * Record every method call made on `subject`, and hand back something that behaves
   * exactly like it.
   *
   * A `Proxy` rather than a subclass or a hand-written wrapper, so it works for any port
   * without knowing one method name: a port gaining a method does not need a line here.
   * Calls are applied to the original, never to the proxy, so a double's own internals —
   * and a double calling one of its own methods — behave as they did unwatched.
   *
   * Property *reads* are not recorded. `clips.all` and `media.objectCount` are how a
   * test looks at a double, not something a use case did.
   */
  watch<T extends object>(target: string, subject: T): T {
    return new Proxy(subject, {
      get: (held, property): unknown => {
        const value: unknown = Reflect.get(held, property, held)
        if (typeof value !== 'function') return value

        const name = `${target}.${String(property)}`
        return (...args: readonly unknown[]): unknown => {
          this.entries.push(name)
          return Reflect.apply(value, held, args)
        }
      },
    })
  }
}
