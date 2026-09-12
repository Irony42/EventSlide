/**
 * `npm run db:seed:demo`
 *
 * Fills a database with a realistic event so the wall, the moderation console and the
 * admin dashboard can be looked at without an actual party. Also the fixture the
 * visual snapshots are taken against, which is why the photo set and the decisions are
 * fixed rather than random — a seed that varied would make every snapshot a diff.
 *
 * Everything goes through the real use cases. Writing rows directly would let the seed
 * create states the application cannot produce, and a screen built on impossible state
 * teaches you nothing.
 */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { loadConfig } from '../src/infrastructure/config/env'
import { createContainer } from '../src/main/container'
import { asGuestId, asUserId, type PhotoId } from '../src/domain/shared/ids'

const OWNER = {
  email: 'demo@eventslide.test',
  password: 'demo-passphrase-not-for-production',
}

const EVENT = { slug: 'camille-et-sacha', name: 'Camille & Sacha' }

/** Fixed so the visual snapshots are stable. Portrait and landscape, mixed. */
const PHOTOS = [
  { label: 'confettis', width: 1600, height: 1200, caption: 'Les confettis', by: 'Léa' },
  { label: 'gateau', width: 1200, height: 1600, caption: 'Le gâteau', by: 'Léa' },
  { label: 'discours', width: 1600, height: 1067, caption: 'Le discours', by: 'Tom' },
  { label: 'danse', width: 1067, height: 1600, caption: null, by: 'Tom' },
  { label: 'table', width: 1600, height: 1200, caption: 'La table 4', by: null },
  { label: 'sortie', width: 1600, height: 900, caption: 'La sortie', by: null },
  // Left pending on purpose, so the moderation console has something in its queue and
  // the wall has something it must not show.
  { label: 'flou', width: 1200, height: 900, caption: 'Ratée', by: 'Léa' },
  { label: 'doublon', width: 1200, height: 900, caption: null, by: 'Tom' },
] as const

/** A distinct, deterministic colour per photo — no palette, no randomness. */
const jpeg = async (label: string, width: number, height: number): Promise<Uint8Array> => {
  const hue = [...label].reduce((total, character) => total + character.charCodeAt(0), 0)
  return new Uint8Array(
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: hue % 256, g: (hue * 3) % 256, b: (hue * 7) % 256 },
      },
    })
      .jpeg({ quality: 88 })
      .toBuffer(),
  )
}

const main = async (): Promise<void> => {
  const config = loadConfig()
  if (config.isProduction) {
    console.error('Refusing to seed a production database.')
    process.exit(1)
  }

  const container = await createContainer(config)
  const { usecases } = container
  const scratch = await mkdtemp(join(tmpdir(), 'eventslide-seed-'))

  try {
    // ------------------------------------------------------------ the owner --
    const owner = await usecases.bootstrapOwner({
      email: OWNER.email,
      password: OWNER.password,
      displayName: 'Camille',
    })
    if (!owner.ok) {
      console.error(`Could not create the demo owner: ${owner.error.code}`)
      process.exit(1)
    }
    // `bootstrapOwner` is a no-op on a non-empty database, so a second run needs the
    // existing account's id rather than the one it would have created.
    const ownerId = owner.value.created
      ? owner.value.userId
      : await resolveOwnerId(container, OWNER.email)

    // ------------------------------------------------------------- the event --
    const created = await usecases.createEvent({ ownerId, name: EVENT.name, slug: EVENT.slug })
    if (!created.ok) {
      if (created.error.code === 'event.slugTaken') {
        console.log(`The demo event already exists at /e/${EVENT.slug} — nothing to do.`)
        return
      }
      console.error(`Could not create the demo event: ${created.error.code}`)
      process.exit(1)
    }
    const event = created.value

    const live = await usecases.changeEventStatus({
      eventId: event.id,
      actorId: ownerId,
      status: 'live',
    })
    if (!live.ok) {
      console.error(`Could not open the demo event: ${live.error.code}`)
      process.exit(1)
    }

    // ------------------------------------------------------------ the guests --
    const guests = new Map<string, string>()
    for (const name of ['Léa', 'Tom']) {
      const joined = await usecases.joinEvent({
        joinCode: event.joinCode.value,
        displayName: name,
      })
      if (!joined.ok) {
        console.error(`Could not join as ${name}: ${joined.error.code}`)
        process.exit(1)
      }
      guests.set(name, joined.value.guestId)
    }
    const anonymous = await usecases.joinEvent({
      joinCode: event.joinCode.value,
      displayName: null,
    })
    if (!anonymous.ok) {
      console.error(`Could not join anonymously: ${anonymous.error.code}`)
      process.exit(1)
    }

    // ------------------------------------------------------------ the photos --
    const uploaded: PhotoId[] = []
    for (const photo of PHOTOS) {
      const guestId = photo.by === null ? anonymous.value.guestId : guests.get(photo.by)
      if (guestId === undefined) continue

      const bytes = await jpeg(photo.label, photo.width, photo.height)
      // Written to disk as well, so the fixtures can be inspected by eye when a
      // snapshot diff is puzzling.
      await writeFile(join(scratch, `${photo.label}.jpg`), bytes)

      const result = await usecases.uploadPhotos({
        eventId: event.id,
        author: { kind: 'guest', guestId: asGuestId(guestId) },
        files: [{ bytes, declaredName: `${photo.label}.jpg` }],
        caption: photo.caption,
      })
      if (!result.ok) {
        console.error(`Could not upload ${photo.label}: ${result.error.code}`)
        continue
      }
      for (const outcome of result.value.outcomes) {
        if (outcome.kind === 'stored') uploaded.push(outcome.photoId)
      }
    }

    // --------------------------------------------------------- the decisions --
    // The last two stay pending, so the console has a queue and the wall has photos it
    // must not show. A demo where everything is already published hides the product's
    // central promise.
    const toPublish = uploaded.slice(0, Math.max(0, uploaded.length - 2))
    for (const photoId of toPublish) {
      const moderated = await usecases.moderatePhoto({
        eventId: event.id,
        photoId: photoId,
        decision: 'publish',
        actor: { kind: 'host', userId: ownerId },
      })
      if (!moderated.ok) {
        console.error(`Could not publish ${photoId}: ${moderated.error.code}`)
      }
    }

    // --------------------------------------------------------- the reactions --
    const kinds = ['love', 'laugh', 'wow', 'cheers', 'clap'] as const
    for (const [index, photoId] of toPublish.entries()) {
      // A descending spread, so "photo of the night" has an unambiguous winner.
      for (const kind of kinds.slice(0, Math.max(1, kinds.length - index))) {
        for (const guestId of [...guests.values(), anonymous.value.guestId]) {
          await usecases.reactToPhoto({
            eventId: event.id,
            photoId,
            guestId: asGuestId(guestId),
            kind,
          })
        }
      }
    }

    console.log(`
  Demo event seeded.

    Wall        ${config.publicUrl}/e/${EVENT.slug}/display
    Join        ${config.publicUrl}/join/${event.joinCode.value}
    Moderation  ${config.publicUrl}/admin/events/${EVENT.slug}/moderation

    Host        ${OWNER.email}
    Password    ${OWNER.password}

  ${toPublish.length} published, ${uploaded.length - toPublish.length} awaiting moderation.
  Generated fixtures: ${scratch}
`)
  } finally {
    await container.dispose()
  }
}

/**
 * The owner's id on a second run.
 *
 * Reaches for the repository through the container rather than adding a use case for
 * it: this is a development script, and a "find the user id by email" capability has
 * no business existing in the application's surface where a route could reach it.
 */
const resolveOwnerId = async (
  container: Awaited<ReturnType<typeof createContainer>>,
  email: string,
): Promise<Parameters<typeof container.usecases.createEvent>[0]['ownerId']> => {
  const row = container.db
    .prepare<[string], { id: string }>('SELECT id FROM users WHERE email = ?')
    .get(email)
  if (row === undefined) throw new Error(`no user with the email ${email}`)
  // The boundary cast: a database row becoming a domain id.
  return asUserId(row.id)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
