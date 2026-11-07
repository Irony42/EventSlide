import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeEventSource } from './fakeEventSource'

describe('FakeEventSource', () => {
  beforeEach(() => {
    FakeEventSource.reset()
  })

  it('records every connection and names the newest', () => {
    const first = new FakeEventSource('/a')
    const second = new FakeEventSource('/b', { withCredentials: true })
    expect(FakeEventSource.instances).toEqual([first, second])
    expect(FakeEventSource.latest()).toBe(second)
    expect(second.init).toEqual({ withCredentials: true })
  })

  it('forgets the connections on reset', () => {
    new FakeEventSource('/a')
    FakeEventSource.reset()
    expect(FakeEventSource.instances).toHaveLength(0)
  })

  it('throws, naming the opener, when nothing was opened', () => {
    expect(() => FakeEventSource.latest('the wall')).toThrow('no stream was opened by the wall')
  })

  it('counts closes and reports readyState CLOSED', () => {
    const source = new FakeEventSource('/a')
    expect(source.closed).toBe(false)
    source.close()
    source.close()
    expect(source.closeCount).toBe(2)
    expect(source.closed).toBe(true)
    expect(source.readyState).toBe(2)
  })

  it('goes live on emitOpen', () => {
    const source = new FakeEventSource('/a')
    const onOpen = vi.fn()
    source.addEventListener('open', onOpen)
    source.emitOpen()
    expect(source.readyState).toBe(1)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('delivers frames and signals as `change` events', () => {
    const source = new FakeEventSource('/a')
    const seen: string[] = []
    source.addEventListener('change', (event) => seen.push((event as MessageEvent<string>).data))
    source.emitFrame('raw')
    source.emitSignal('photo.uploaded')
    expect(seen).toEqual(['raw', '{"type":"photo.uploaded"}'])
  })

  it('delivers the heartbeat as a named `ping` event, not a change', () => {
    const source = new FakeEventSource('/a')
    const onPing = vi.fn()
    const onChange = vi.fn()
    source.addEventListener('ping', onPing)
    source.addEventListener('change', onChange)
    source.emitHeartbeat()
    expect(onPing).toHaveBeenCalledTimes(1)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('tells a retried drop from a refusal by readyState', () => {
    const source = new FakeEventSource('/a')
    const onError = vi.fn()
    source.addEventListener('error', onError)
    source.emitOpen()
    source.emitDrop()
    expect(source.readyState).toBe(0)
    source.emitRefusal()
    expect(source.readyState).toBe(2)
    expect(onError).toHaveBeenCalledTimes(2)
  })
})
