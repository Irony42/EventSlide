import { describe, expect, it } from 'vitest'
import type { JoinCode } from '../../../domain/shared/joinCode'
import { FakeEventRepository } from '../../testing/fakeEventRepository'
import { SequentialIdGenerator } from '../../testing/sequentialIdGenerator'
import { allocateJoinCode, MAX_JOIN_CODE_ATTEMPTS } from './allocateJoinCode'

/** An event repository that says a code is taken for the first `taken` questions, and records every one. */
class ScriptedTaken extends FakeEventRepository {
  readonly asked: string[] = []

  constructor(private readonly taken: number) {
    super()
  }

  override async joinCodeTaken(code: JoinCode): Promise<boolean> {
    this.asked.push(code.value)
    return this.asked.length <= this.taken
  }
}

/** A generator that hands back fewer bytes than were asked for, as a broken source would. */
class ShortGenerator extends SequentialIdGenerator {
  override bytes(): Uint8Array {
    return new Uint8Array(2)
  }
}

describe('allocateJoinCode', () => {
  it('refuses a generator that returns the wrong number of bytes, before asking about any code', async () => {
    const events = new ScriptedTaken(0)

    const result = await allocateJoinCode(events, new ShortGenerator(), 6)

    expect(!result.ok && result.error.code).toBe('joinCode.wrongEntropyLength')
    expect(events.asked).toEqual([])
  })

  it('answers the first code when it is free, asking once', async () => {
    const events = new ScriptedTaken(0)

    const result = await allocateJoinCode(events, new SequentialIdGenerator(), 6)

    expect(result.ok && result.value.value).toBe(events.asked[0])
    expect(events.asked).toHaveLength(1)
  })

  it('draws a new code after a collision, and answers the one that was free', async () => {
    const events = new ScriptedTaken(2)

    const result = await allocateJoinCode(events, new SequentialIdGenerator(), 6)

    expect(result.ok && result.value.value).toBe(events.asked[2])
    expect(new Set(events.asked).size).toBe(3)
  })

  it('takes a code that is free on the last attempt', async () => {
    const events = new ScriptedTaken(MAX_JOIN_CODE_ATTEMPTS - 1)

    const result = await allocateJoinCode(events, new SequentialIdGenerator(), 6)

    expect(result.ok).toBe(true)
    expect(events.asked).toHaveLength(MAX_JOIN_CODE_ATTEMPTS)
  })

  it('gives up after exactly five attempts, as the box being broken and not the host’s input', async () => {
    const events = new ScriptedTaken(Number.POSITIVE_INFINITY)

    const result = await allocateJoinCode(events, new SequentialIdGenerator(), 6)

    expect(events.asked).toHaveLength(5)
    expect(!result.ok && [result.error.kind, result.error.code, result.error.details]).toEqual([
      'unexpected',
      'event.joinCodeExhausted',
      { attempts: 5 },
    ])
  })

  it('mints a code of the length it was asked for', async () => {
    const result = await allocateJoinCode(new FakeEventRepository(), new SequentialIdGenerator(), 8)

    expect(result.ok && result.value.value).toHaveLength(8)
  })
})
