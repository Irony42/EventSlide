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
import { loadMaintenanceConfig } from '../src/infrastructure/config/env'
import { createContainer } from '../src/main/container'
import { SqliteUserRepository } from '../src/infrastructure/db/sqliteUserRepository'
import { asGuestId, type PhotoId } from '../src/domain/shared/ids'

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

const execute = async (env: NodeJS.ProcessEnv): Promise<number> => {
  const config = loadMaintenanceConfig(env)
  const container = await createContainer(config)
  const { usecases } = container

  /**
   * **The guard is the database, not the environment.**
   *
   * This used to be `if (config.isProduction)`, and that stopped being a guard the moment
   * `NODE_ENV` became something an npm script could supply: a refusal whose only input is
   * a variable written two lines away in `package.json` refuses nothing. `disabled_at`
   * taught this branch the same lesson from the other end — a control that reads the
   * caller's own claim is not a control.
   *
   * An account is the fact that cannot be forged from outside. Every configured box has
   * one, because a box with no owner cannot be logged into; a fresh checkout has none.
   * And the demo owner's password is a constant in this file, so seeding a box somebody
   * is actually using would hand it an account whose credentials are published here.
   */
  if (!(await new SqliteUserRepository(container.db).isEmpty())) {
    console.error(
      'Refusing to seed: this database already holds an account, so it is not a fresh\n' +
        'install. `npm run db:seed:demo` fills an empty database so the wall and the\n' +
        'console can be looked at before there is a real event. Point DATABASE_PATH at a\n' +
        'scratch file if that is what you meant.',
    )
    await container.dispose()
    return 1
  }
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
      return 1
    }
    // The guard above refused any database holding an account, so this always creates.
    const ownerId = owner.value.userId

    // ------------------------------------------------------------- the event --
    const created = await usecases.createEvent({ ownerId, name: EVENT.name, slug: EVENT.slug })
    if (!created.ok) {
      console.error(`Could not create the demo event: ${created.error.code}`)
      return 1
    }
    const event = created.value

    const live = await usecases.changeEventStatus({
      eventId: event.id,
      actorId: ownerId,
      status: 'live',
    })
    if (!live.ok) {
      console.error(`Could not open the demo event: ${live.error.code}`)
      return 1
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
        return 1
      }
      guests.set(name, joined.value.guestId)
    }
    const anonymous = await usecases.joinEvent({
      joinCode: event.joinCode.value,
      displayName: null,
    })
    if (!anonymous.ok) {
      console.error(`Could not join anonymously: ${anonymous.error.code}`)
      return 1
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
    return 0
  } finally {
    await container.dispose()
  }
}

/**
 * The whole command, as a function of its environment: exported and returning an exit code (see
 * `backup.ts`) so a test can drive it, `dispose` running on every path.
 */
export const run = async (env: NodeJS.ProcessEnv = process.env): Promise<number> => {
  try {
    return await execute(env)
  } catch (error) {
    console.error(error)
    return 1
  }
}

/** Run as a program, and not when a test imports `run`. */
if (require.main === module) {
  void run().then((code) => {
    process.exitCode = code
  })
}
