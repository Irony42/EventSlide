import { describe, expect, it } from 'vitest'
import { requestBook, type BookOptions } from '../../../domain/book/albumBook'
import { asEventId } from '../../../domain/shared/ids'
import { AT } from '../../testing/builders'
import { CapturingLogger } from '../../testing/capturingLogger'
import { FakeAlbumBookRepository } from '../../testing/fakeAlbumBookRepository'
import { makeRecoverAlbumBooks } from './recoverAlbumBooks'

const OPTIONS: BookOptions = {
  title: 'T',
  subtitle: '',
  language: 'fr',
  layout: 'one',
  showAuthors: true,
  showCaptions: true,
}

describe('recoverAlbumBooks', () => {
  it('puts a book left running by a dead process back in the queue, and says so', async () => {
    const books = new FakeAlbumBookRepository()
    const logger = new CapturingLogger()
    await books.saveRequest(requestBook(asEventId('e1'), OPTIONS, AT))
    await books.claimNext(AT)

    const report = await makeRecoverAlbumBooks({ books, logger })()

    expect(report).toEqual({ requeued: 1 })
    expect((await books.find(asEventId('e1')))?.status).toBe('queued')
    expect(logger.lines.some((line) => line.level === 'warn')).toBe(true)
  })

  it('does nothing, quietly, when nothing was running', async () => {
    const books = new FakeAlbumBookRepository()
    const logger = new CapturingLogger()

    expect(await makeRecoverAlbumBooks({ books, logger })()).toEqual({ requeued: 0 })
    expect(logger.lines).toEqual([])
  })
})
