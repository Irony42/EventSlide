import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { FakeDiskSpaceChecker } from '../../../application/testing/fakeDiskSpaceChecker'
import { createDiskSpaceGuard } from './diskSpaceGuard'

const DATABASE_DIR = '/data'
const MEDIA_ROOT = '/media'
const MIN_FREE_BYTES = 1_000_000

const appWith = (checker: FakeDiskSpaceChecker): express.Express => {
  const app = express()
  app.get(
    '/upload',
    createDiskSpaceGuard({
      checker,
      paths: [DATABASE_DIR, MEDIA_ROOT],
      minFreeBytes: MIN_FREE_BYTES,
    }),
    (_req, res) => {
      res.status(204).end()
    },
  )
  return app
}

describe('createDiskSpaceGuard', () => {
  it('admits the request when every checked path clears the floor', async () => {
    const checker = new FakeDiskSpaceChecker()
      .set(DATABASE_DIR, MIN_FREE_BYTES)
      .set(MEDIA_ROOT, MIN_FREE_BYTES)

    const response = await request(appWith(checker)).get('/upload')

    expect(response.status).toBe(204)
  })

  it('answers 413 storage.boxFull when the database directory is below the floor', async () => {
    const checker = new FakeDiskSpaceChecker()
      .set(DATABASE_DIR, MIN_FREE_BYTES - 1)
      .set(MEDIA_ROOT, MIN_FREE_BYTES)

    const response = await request(appWith(checker)).get('/upload')

    expect(response.status).toBe(413)
    expect(response.body.error.code).toBe('storage.boxFull')
  })

  it('answers 413 storage.boxFull when the media root is below the floor, even if the database directory has room', async () => {
    const checker = new FakeDiskSpaceChecker()
      .set(DATABASE_DIR, MIN_FREE_BYTES)
      .set(MEDIA_ROOT, MIN_FREE_BYTES - 1)

    const response = await request(appWith(checker)).get('/upload')

    expect(response.status).toBe(413)
    expect(response.body.error.code).toBe('storage.boxFull')
  })

  it('answers 413 storage.boxFull when a path could not be read at all', async () => {
    const checker = new FakeDiskSpaceChecker()
      .set(DATABASE_DIR, null)
      .set(MEDIA_ROOT, MIN_FREE_BYTES)

    const response = await request(appWith(checker)).get('/upload')

    expect(response.status).toBe(413)
    expect(response.body.error.code).toBe('storage.boxFull')
  })

  it('sets no Retry-After, because nothing about this refusal is on a timer', async () => {
    const checker = new FakeDiskSpaceChecker().set(DATABASE_DIR, 0).set(MEDIA_ROOT, 0)

    const response = await request(appWith(checker)).get('/upload')

    expect(response.headers['retry-after']).toBeUndefined()
  })
})
