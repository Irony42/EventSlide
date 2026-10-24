import { describe, expect, it } from 'vitest'
import { CapturingLogger, silentLogger } from './capturingLogger'

describe('CapturingLogger', () => {
  it('keeps each line with its level, message and context, in order', () => {
    const logger = new CapturingLogger()

    logger.debug('first')
    logger.info('second', { n: 2 })
    logger.warn('third', { n: 3 })
    logger.error('fourth')

    expect(logger.lines).toEqual([
      { level: 'debug', message: 'first', context: undefined },
      { level: 'info', message: 'second', context: { n: 2 } },
      { level: 'warn', message: 'third', context: { n: 3 } },
      { level: 'error', message: 'fourth', context: undefined },
    ])
  })

  it('keeps what a child logs in the same list', () => {
    const logger = new CapturingLogger()

    logger.child({ requestId: 'r1' }).info('from a child')

    expect(logger.messages('info')).toEqual(['from a child'])
  })

  it('lists the messages of one level only', () => {
    const logger = new CapturingLogger()
    logger.info('kept')
    logger.warn('not this level')
    logger.info('also kept')

    expect(logger.messages('info')).toEqual(['kept', 'also kept'])
  })

  it('finds a line by its message, for a test that reads its context', () => {
    const logger = new CapturingLogger()
    logger.info('a pass finished', { durationMs: 12 })

    expect(logger.find('a pass finished')?.context).toEqual({ durationMs: 12 })
    expect(logger.find('never said')).toBeUndefined()
  })
})

describe('silentLogger', () => {
  it('says nothing at any level, and its children are as quiet', () => {
    const logger = silentLogger()

    expect(() => {
      logger.debug('x')
      logger.info('x')
      logger.warn('x')
      logger.error('x')
      logger.child({ a: 1 }).error('x')
    }).not.toThrow()
  })
})
