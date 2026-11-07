import { createServer } from 'node:http'
import express from 'express'
import { describe, expect, it } from 'vitest'
import request from './request'

/**
 * The shared `supertest` entry: what it promises is the reason it exists, a port and a socket per
 * app and not per request (see the note in `request.ts`). Each app below answers with the two
 * ends of the connection it was reached on.
 */

const anApp = () => {
  const app = express()
  app.get('/where', (req, res) => {
    res.json({ port: req.socket.localPort, client: req.socket.remotePort })
  })
  app.get('/set', (_req, res) => {
    res.cookie('seen', 'yes').sendStatus(204)
  })
  app.get('/cookie', (req, res) => {
    res.json({ cookie: req.headers.cookie ?? null })
  })
  return app
}

describe('request', () => {
  it('serves every request of an app from one listening server', async () => {
    const app = anApp()

    const first = await request(app).get('/where')
    const second = await request(app).get('/where')
    const third = await request.agent(app).get('/where')

    expect(second.body.port).toBe(first.body.port)
    expect(third.body.port).toBe(first.body.port)
  })

  it('gives another app a server of its own', async () => {
    const one = await request(anApp()).get('/where')
    const other = await request(anApp()).get('/where')

    expect(other.body.port).not.toBe(one.body.port)
  })

  it('sends successive requests over one connection instead of opening a socket each', async () => {
    const app = anApp()

    const first = await request(app).get('/where')
    const second = await request(app).get('/where')

    expect(second.body.client).toBe(first.body.client)
  })

  it('keeps an agent’s cookies, which is what a signed-in session is', async () => {
    const agent = request.agent(anApp())
    await agent.get('/set').expect(204)

    const response = await agent.get('/cookie')

    expect(response.body.cookie).toBe('seen=yes')
  })

  it('leaves a target that is not an app alone', async () => {
    const app = anApp()
    const viaApp = await request(app).get('/where')

    const viaUrl = await request(`http://127.0.0.1:${viaApp.body.port}`).get('/where')

    expect(viaUrl.body.port).toBe(viaApp.body.port)
  })

  it('leaves a server that is already listening alone: it is the caller’s, and the caller closes it', async () => {
    const server = createServer(anApp())
    server.listen(0)
    try {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : -1

      const response = await request(server).get('/where')

      expect(response.body.port).toBe(port)
      expect(server.listening).toBe(true)
    } finally {
      server.close()
    }
  })
})
