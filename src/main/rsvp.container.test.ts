import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from '../interface/http/testing/request'
import { afterEach, describe, expect, it } from 'vitest'
import { asUserId } from '../domain/shared/ids'
import { loadConfig } from '../infrastructure/config/env'
import { CSRF_COOKIE, CSRF_HEADER } from '../interface/http/middleware/csrf'
import { createContainer, type Container } from './container'

/**
 * **The guests' replies are wired in the container** (spec 30): the host routes reach the real use
 * cases over the real SQLite adapter, the audit trail carries the acts and no content, the badge
 * is the owner's own, a reply goes with its event, and the sweep's use case erases what is due.
 *
 * The line that joins a route to the thing it calls is in the container, which no ring-4 test
 * builds. This boots the real one, signs the box's owner in and asks each route.
 */

const OWNER = 'hote@example.org'
const PASSWORD = 'un-mot-de-passe-solide'
const SLUG = 'fete-de-lea'
const BASE = `/api/events/${SLUG}`

let workDir: string | null = null
let container: Container | null = null

afterEach(async () => {
  await container?.dispose()
  container = null
  if (workDir !== null) await rm(workDir, { recursive: true, force: true })
  workDir = null
})

const csrfOf = (headers: Record<string, unknown>): string | undefined => {
  const raw = headers['set-cookie']
  const cookies = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : []
  const found = cookies.find((cookie) => cookie.startsWith(`${CSRF_COOKIE}=`))
  return found === undefined
    ? undefined
    : decodeURIComponent(found.slice(CSRF_COOKIE.length + 1).split(';')[0] ?? '')
}

const PARTY = {
  title: 'Léa fête ses 40 ans',
  // Far enough ahead that the box's real clock finds the window open, and the sweep finds nothing due.
  startsAt: '2099-12-13T18:00:00Z',
  timeZone: 'Europe/Paris',
}

const REPLY = { name: 'Léa Martin', answer: 'yes', adults: 2, kids: 1, diet: 'sans gluten' }

const boot = async () => {
  workDir = await mkdtemp(join(tmpdir(), 'eventslide-rsvp-'))
  const booted = await createContainer(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_PATH: join(workDir, 'eventslide.sqlite'),
      MEDIA_ROOT: join(workDir, 'media'),
      FFMPEG_PATH: join(workDir, 'no-ffmpeg-here'),
      FFPROBE_PATH: join(workDir, 'no-ffprobe-here'),
      BOOTSTRAP_OWNER_EMAIL: OWNER,
      BOOTSTRAP_OWNER_PASSWORD: PASSWORD,
    }),
  )
  container = booted
  booted.db.prepare('UPDATE users SET must_change_password = 0').run()
  const row = booted.db
    .prepare<[string], { readonly id: string }>('SELECT id FROM users WHERE email = ?')
    .get(OWNER)
  const created = await booted.usecases.createEvent({
    ownerId: asUserId(row?.id ?? ''),
    name: 'Fête de Léa',
    slug: SLUG,
  })
  if (!created.ok) throw new Error(`fixture rejected: ${created.error.code}`)

  const agent = request.agent(booted.app)
  let csrf = csrfOf((await agent.get('/api/auth/me')).headers) ?? ''
  const login = await agent
    .post('/api/auth/login')
    .set(CSRF_HEADER, csrf)
    .send({ email: OWNER, password: PASSWORD })
  expect(login.status, JSON.stringify(login.body)).toBe(200)
  csrf = csrfOf(login.headers) ?? csrf

  const invite = await agent.put(`${BASE}/guest-invite`).set(CSRF_HEADER, csrf).send(PARTY)
  expect(invite.status, JSON.stringify(invite.body)).toBe(200)
  const on = await agent.post(`${BASE}/guest-invite/enable`).set(CSRF_HEADER, csrf).send({})
  expect(on.status, JSON.stringify(on.body)).toBe(200)

  return {
    booted,
    db: booted.db,
    agent,
    csrf: () => csrf,
    eventId: created.value.id,
  }
}

describe('the guests replies, through the real container', () => {
  it('saves the form, takes a reply, lists it, corrects it and deletes it over the real database', async () => {
    const { db, agent, csrf } = await boot()

    const saved = await agent
      .put(`${BASE}/rsvp-form`)
      .set(CSRF_HEADER, csrf())
      .send({ enabled: true, deadline: '2099-12-01', form: { maybe: false } })
    expect(saved.status, JSON.stringify(saved.body)).toBe(200)
    expect(saved.body.rsvpForm).toMatchObject({
      enabled: true,
      deadline: '2099-12-01',
      state: 'open',
    })
    expect(db.prepare('SELECT rsvp_enabled, rsvp_deadline FROM guest_invites').get()).toEqual({
      rsvp_enabled: 1,
      rsvp_deadline: '2099-12-01',
    })
    expect((await agent.get(`${BASE}/rsvp-form`)).body.rsvpForm.form.maybe).toBe(false)

    const added = await agent.post(`${BASE}/rsvps`).set(CSRF_HEADER, csrf()).send(REPLY)
    expect(added.status, JSON.stringify(added.body)).toBe(201)
    const id = added.body.rsvp.id as string

    const list = await agent.get(`${BASE}/rsvps`)
    expect(list.body.rsvps).toHaveLength(1)
    expect(list.body.stats.yes).toEqual({ responses: 1, people: 3, adults: 2, kids: 1 })

    const edited = await agent
      .put(`${BASE}/rsvps/${id}`)
      .set(CSRF_HEADER, csrf())
      .send({ name: 'Léa M.', answer: 'no' })
    expect(edited.body.rsvp).toMatchObject({ id, name: 'Léa M.', answer: 'no' })

    const closed = await agent.post(`${BASE}/rsvp-form/close`).set(CSRF_HEADER, csrf()).send({})
    expect(closed.body.rsvpForm.state).toBe('closed')
    const reopened = await agent.post(`${BASE}/rsvp-form/reopen`).set(CSRF_HEADER, csrf()).send({})
    expect(reopened.body.rsvpForm.state).toBe('open')

    const deleted = await agent.delete(`${BASE}/rsvps/${id}`).set(CSRF_HEADER, csrf())
    expect(deleted.status).toBe(204)
    expect(db.prepare('SELECT COUNT(*) AS n FROM guest_rsvps').get()).toEqual({ n: 0 })
  })

  it('counts the badge for the owner’s own account and empties it when they look', async () => {
    const { db, agent, csrf, eventId } = await boot()
    // A guest's reply, as the public route of the next pull request will write it.
    db.prepare(
      `INSERT INTO guest_rsvps (id, event_id, name, answer, adults, kids, details, source, created_at, updated_at)
       VALUES ('d1000000-0000-4000-8000-000000000001', ?, 'Invité', 'yes', 1, 0, '{}', 'open', ?, ?)`,
    ).run(eventId, new Date().toISOString(), new Date().toISOString())
    // The host's own add is not news to them, whatever the count already held.
    await agent.post(`${BASE}/rsvps`).set(CSRF_HEADER, csrf()).send(REPLY).expect(201)

    expect((await agent.get(BASE)).body.unseenRsvps).toBe(2)
    expect((await agent.get(`${BASE}/rsvps`)).body.unseen).toBe(2)

    await agent.post(`${BASE}/rsvps/seen`).set(CSRF_HEADER, csrf()).send({}).expect(204)

    expect((await agent.get(BASE)).body.unseenRsvps).toBe(0)
    expect((await agent.get(`${BASE}/rsvps`)).body.unseen).toBe(0)
  })

  it('exports the replies as a download, audited', async () => {
    const { db, agent, csrf } = await boot()
    await agent.post(`${BASE}/rsvps`).set(CSRF_HEADER, csrf()).send(REPLY).expect(201)

    const file = await agent.get(`${BASE}/rsvps/export`).buffer(true)

    expect(file.status).toBe(200)
    expect(file.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(file.text).toContain('Léa Martin')
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'event.rsvpsExported'`).get(),
    ).toEqual({ n: 1 })
  })

  it('writes the acts to the audit log with no content in them', async () => {
    const { db, agent, csrf } = await boot()
    await agent.put(`${BASE}/rsvp-form`).set(CSRF_HEADER, csrf()).send({ enabled: true })
    const { body } = await agent.post(`${BASE}/rsvps`).set(CSRF_HEADER, csrf()).send(REPLY)
    await agent
      .put(`${BASE}/rsvps/${String(body.rsvp.id)}`)
      .set(CSRF_HEADER, csrf())
      .send(REPLY)
    await agent.post(`${BASE}/rsvp-form/close`).set(CSRF_HEADER, csrf()).send({})
    await agent.post(`${BASE}/rsvp-form/reopen`).set(CSRF_HEADER, csrf()).send({})
    await agent.delete(`${BASE}/rsvps/${String(body.rsvp.id)}`).set(CSRF_HEADER, csrf())

    const lines = db
      .prepare<[], { readonly action: string; readonly details: string }>(
        `SELECT action, details FROM audit_log WHERE action LIKE 'event.rsvp%' ORDER BY seq`,
      )
      .all()

    expect(lines.map((line) => line.action)).toEqual([
      'event.rsvpFormSaved',
      'event.rsvpHostAdded',
      'event.rsvpHostEdited',
      'event.rsvpsClosed',
      'event.rsvpsReopened',
      'event.rsvpHostDeleted',
    ])
    expect(JSON.stringify(lines)).not.toContain('Léa')
    expect(JSON.stringify(lines)).not.toContain('gluten')
    expect(lines.every((line) => line.details === '{}')).toBe(true)
  })

  it('goes with its event: deleting the event deletes its replies', async () => {
    const { db, agent, csrf, eventId } = await boot()
    await agent.post(`${BASE}/rsvps`).set(CSRF_HEADER, csrf()).send(REPLY).expect(201)
    expect(db.prepare('SELECT COUNT(*) AS n FROM guest_rsvps').get()).toEqual({ n: 1 })

    db.prepare('DELETE FROM events WHERE id = ?').run(eventId)

    expect(db.prepare('SELECT COUNT(*) AS n FROM guest_rsvps').get()).toEqual({ n: 0 })
  })

  it('erases the replies of an event closed long ago even when the operator holds its purge', async () => {
    const { booted, db, agent, csrf, eventId } = await boot()
    await agent.post(`${BASE}/rsvps`).set(CSRF_HEADER, csrf()).send(REPLY).expect(201)
    db.prepare('UPDATE events SET closed_at = ?, purge_held_at = ? WHERE id = ?').run(
      '2020-01-01T00:00:00.000Z',
      '2020-02-01T00:00:00.000Z',
      eventId,
    )

    expect(await booted.usecases.purgeExpiredRsvps()).toEqual({ deleted: 1 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM guest_rsvps').get()).toEqual({ n: 0 })
  })

  it('erases the replies of an event never closed once its invitation started more than 60 days ago', async () => {
    const { booted, db, agent, csrf, eventId } = await boot()
    await agent.post(`${BASE}/rsvps`).set(CSRF_HEADER, csrf()).send(REPLY).expect(201)
    expect(db.prepare('SELECT closed_at FROM events WHERE id = ?').get(eventId)).toEqual({
      closed_at: null,
    })

    db.prepare('UPDATE guest_invites SET starts_at = ? WHERE event_id = ?').run(
      new Date(Date.now() - 59 * 86_400_000).toISOString(),
      eventId,
    )
    expect(await booted.usecases.purgeExpiredRsvps()).toEqual({ deleted: 0 })

    db.prepare('UPDATE guest_invites SET starts_at = ? WHERE event_id = ?').run(
      new Date(Date.now() - 61 * 86_400_000).toISOString(),
      eventId,
    )
    expect(await booted.usecases.purgeExpiredRsvps()).toEqual({ deleted: 1 })
  })

  it('erases the replies of an event closed long ago, through the use case the sweep runs', async () => {
    const { booted, db, agent, csrf, eventId } = await boot()
    await agent.post(`${BASE}/rsvps`).set(CSRF_HEADER, csrf()).send(REPLY).expect(201)

    expect(await booted.usecases.purgeExpiredRsvps()).toEqual({ deleted: 0 })
    db.prepare('UPDATE events SET closed_at = ? WHERE id = ?').run(
      '2020-01-01T00:00:00.000Z',
      eventId,
    )

    expect(await booted.usecases.purgeExpiredRsvps()).toEqual({ deleted: 1 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM guest_rsvps').get()).toEqual({ n: 0 })
  })
})

describe('a guest’s side of the replies, through the real container', () => {
  /** The invitation's token and a browser that has opened its page (so it holds the CSRF cookie). */
  const guestBrowser = async () => {
    const world = await boot()
    await world.agent
      .put(`${BASE}/rsvp-form`)
      .set(CSRF_HEADER, world.csrf())
      .send({ enabled: true })
      .expect(200)
    const url = (await world.agent.get(`${BASE}/guest-invite`)).body.guestInvite.url as string
    const invite = url.split('/i/')[1] ?? ''
    const guest = request.agent(world.booted.app)
    const page = await guest.get(`/api/i/${invite}`)
    const cookie = csrfOf(page.headers) ?? ''
    return { ...world, guest, invite, page, cookie, reply: `/api/i/${invite}/rsvp` }
  }

  it('answers, reads, changes and erases a reply with the token in a header, and the host sees it', async () => {
    const { db, agent, guest, page, cookie, reply } = await guestBrowser()
    expect(page.body.rsvp.state).toBe('open')

    const created = await guest
      .post(reply)
      .set(CSRF_HEADER, cookie)
      .send({ name: 'Hugo Roux', answer: 'yes', adults: 2, diet: 'noix' })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const editToken = created.body.editToken as string

    // Only the digest is stored; the host's list carries the reply and never the token.
    const stored = db.prepare('SELECT edit_token_hash, source FROM guest_rsvps').get() as {
      edit_token_hash: string
      source: string
    }
    expect(stored.source).toBe('open')
    expect(stored.edit_token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(stored.edit_token_hash).not.toBe(editToken)
    const listed = await agent.get(`${BASE}/rsvps`)
    expect(listed.body.rsvps).toHaveLength(1)
    expect(JSON.stringify(listed.body)).not.toContain(editToken)

    const read = await guest.get(reply).set('X-Rsvp-Token', editToken)
    expect(read.body.rsvp).toMatchObject({ name: 'Hugo Roux', adults: 2 })
    const changed = await guest
      .put(reply)
      .set(CSRF_HEADER, cookie)
      .set('X-Rsvp-Token', editToken)
      .send({ name: 'Hugo R.', answer: 'no' })
    expect(changed.body.rsvp).toMatchObject({ name: 'Hugo R.', answer: 'no' })

    const erased = await guest.delete(reply).set(CSRF_HEADER, cookie).set('X-Rsvp-Token', editToken)
    expect(erased.status).toBe(204)
    expect(db.prepare('SELECT COUNT(*) AS n FROM guest_rsvps').get()).toEqual({ n: 0 })
  })

  it('refuses a change to a reply deleted meanwhile, and does not store it again', async () => {
    const { db, guest, cookie, reply } = await guestBrowser()
    const created = await guest
      .post(reply)
      .set(CSRF_HEADER, cookie)
      .send({ name: 'Hugo Roux', answer: 'yes', adults: 1 })
    const editToken = created.body.editToken as string
    await guest.delete(reply).set(CSRF_HEADER, cookie).set('X-Rsvp-Token', editToken).expect(204)

    const late = await guest
      .put(reply)
      .set(CSRF_HEADER, cookie)
      .set('X-Rsvp-Token', editToken)
      .send({ name: 'Hugo Roux', answer: 'yes', adults: 1 })

    expect([late.status, late.body.error.code]).toEqual([404, 'rsvp.notFound'])
    expect(db.prepare('SELECT COUNT(*) AS n FROM guest_rsvps').get()).toEqual({ n: 0 })
  })

  it('stores nothing for a honeypot, takes 8 KB and not more, and needs the CSRF header', async () => {
    const { db, guest, cookie, reply } = await guestBrowser()
    const answer = { name: 'Bot', answer: 'yes', adults: 1 }

    const trapped = await guest
      .post(reply)
      .set(CSRF_HEADER, cookie)
      .send({ ...answer, website: 'x' })
    const large = await guest
      .post(reply)
      .set(CSRF_HEADER, cookie)
      .send({ ...answer, message: 'a'.repeat(9_000) })
    const bare = await guest.post(reply).send(answer)

    expect(trapped.status).toBe(201)
    expect([large.status, large.body.error.code]).toEqual([413, 'request.tooLarge'])
    expect(bare.status).toBe(403)
    expect(db.prepare('SELECT COUNT(*) AS n FROM guest_rsvps').get()).toEqual({ n: 0 })
  })

  it('stops answering once the host closes the replies, and keeps the right to erase', async () => {
    const { agent, csrf, guest, cookie, reply } = await guestBrowser()
    const created = await guest
      .post(reply)
      .set(CSRF_HEADER, cookie)
      .send({ name: 'Hugo Roux', answer: 'yes', adults: 1 })
    const editToken = created.body.editToken as string
    await agent.post(`${BASE}/rsvp-form/close`).set(CSRF_HEADER, csrf()).send({}).expect(200)

    const late = await guest
      .post(reply)
      .set(CSRF_HEADER, cookie)
      .send({ name: 'Tom', answer: 'no' })
    const erased = await guest.delete(reply).set(CSRF_HEADER, cookie).set('X-Rsvp-Token', editToken)

    expect([late.status, late.body.error.code]).toEqual([409, 'rsvp.closed'])
    expect(erased.status).toBe(204)
  })
})
