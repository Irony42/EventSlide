import { readFile } from 'node:fs/promises'
import { expect, signInAsHost, test } from '../fixtures/app'
import { aPhoto } from '../fixtures/media'
import { startTestApp } from '../fixtures/startTestApp'
import { SUITE_LOCALE } from '../fixtures/suiteLocale'
import { FakeBotApiServer } from '../../../src/infrastructure/channels/telegram/testing/fakeBotApiServer'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * A Telegram group sends its photographs to an event (spec 27).
 *
 * **Its own server**, because the shared one has no bot token on purpose (a box with none opens no outbound
 * connection, which every other spec relies on). Here the box is pointed at a fake Bot API running in this process
 * (`TELEGRAM_API_BASE_URL`): it speaks the real envelope, serves the file the message names and records what the bot
 * says and reacts with. Real Telegram is never contacted.
 *
 * What only real infrastructure can break, end to end: the host's switch saved through the settings page, the panel
 * built from `GET /channels` and the current join code, the long poll and its saved cursor, the worker, the real photo
 * pipeline (the group's JPEG becomes a stored photograph, held for moderation by the event's own mode), the badge in
 * the console, and the unlink that stops the group.
 */

const TOKEN = '123456789:AAEhBP0av28dHx_2TaQ-9mPzK3l0QbCdEfG'
const GROUP = { id: -1001, type: 'supergroup', title: 'Mariage Léa & Tom' }
const LEA = { id: 42, is_bot: false, first_name: 'Léa', last_name: 'Martin' }

test('a host connects a Telegram group, a photo posted there is moderated and published, then the group is unlinked', async ({
  browser,
}, testInfo) => {
  const bot = new FakeBotApiServer({ token: TOKEN, username: 'EventSlideE2EBot' })
  const botUrl = await bot.start()
  const app = await startTestApp({
    worker: testInfo.workerIndex,
    env: { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_API_BASE_URL: botUrl },
  })
  const context = await browser.newContext({ baseURL: app.baseUrl, locale: SUITE_LOCALE })

  try {
    const event = await app.seedEvent({ slug: 'mariage', name: 'Camille & Sacha' })
    const host = await context.newPage()
    await signInAsHost(host, app)

    // ---- the host switches Telegram on, in the settings, where the section exists because the box has a bot ----

    await host.goto(app.url(`/admin/events/${event.slug}/settings#messaging`))
    const toggle = host.getByLabel(fr.channels.allowTelegram)
    await expect(toggle).not.toBeChecked()
    await toggle.check()
    await expect(host.getByText(fr.admin.settingsPage.saved)).toBeVisible()

    // ---- the event page tells which bot to add and which command to send, with the current code -------------

    await host.goto(app.url(`/admin/events/${event.slug}`))
    await expect(host.getByRole('heading', { name: fr.channels.title })).toBeVisible()
    await expect(host.getByText(fr.channels.step1('EventSlideE2EBot'))).toBeVisible()
    await expect(host.getByText(`/soiree ${event.joinCode}`)).toBeVisible()

    // ---- somebody in the group connects it and posts a photograph ---------------------------------------------

    bot.hold('big', await readFile(await aPhoto('from-the-group', 800, 600)))
    bot.push({
      message: { message_id: 1, chat: GROUP, from: LEA, text: `/soiree ${event.joinCode}` },
    })
    bot.push({
      message: {
        message_id: 2,
        chat: GROUP,
        from: LEA,
        photo: [{ file_id: 'big', width: 800, height: 600, file_size: 30_000 }],
      },
    })

    // The bot answers the command in the group, and acknowledges the photograph with a reaction.
    await expect.poll(() => bot.said().length).toBeGreaterThan(0)
    expect(bot.said()[0]?.text).toContain('Camille & Sacha')
    await expect.poll(() => bot.reactions().length).toBe(1)
    expect(bot.reactions()[0]).toEqual({ chat_id: -1001, message_id: 2 })

    // ---- the console holds it for a decision, badged, as for any guest's photograph -------------------------

    await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
    const card = host.getByTestId('moderation-card').first()
    await expect(card).toBeVisible()
    await expect(card.getByText(fr.channels.viaTelegram)).toBeVisible()
    await expect(card.getByText('Léa M.')).toBeVisible()
    // Nothing is public before the decision.
    const before = await host.request.get(app.url(`/api/events/${event.slug}/wall`))
    expect(JSON.stringify(await before.json())).not.toContain('from-the-group')

    await card.getByRole('button', { name: /Publier/i }).click()
    await expect
      .poll(async () => {
        const wall = await host.request.get(app.url(`/api/events/${event.slug}/wall`))
        const body = (await wall.json()) as { items?: unknown[] }
        return body.items?.length ?? 0
      })
      .toBe(1)

    // ---- the panel lists the group, and the owner unlinks it --------------------------------------------------

    await host.goto(app.url(`/admin/events/${event.slug}`))
    await expect(host.getByText('Mariage Léa & Tom')).toBeVisible()
    await expect(host.getByText(/1 photo reçue/u)).toBeVisible()
    await host.getByRole('button', { name: fr.channels.unlink }).click()
    await host.getByRole('dialog').getByRole('button', { name: fr.channels.unlink }).click()
    await expect(host.getByText(fr.channels.none)).toBeVisible()

    // The bot says so in the group, and a photograph posted afterwards is not taken.
    await expect
      .poll(() =>
        bot
          .said()
          .some(
            (said) => said.text.includes('n’envoie plus') || said.text.includes("n'envoie plus"),
          ),
      )
      .toBe(true)
    bot.push({
      message: {
        message_id: 3,
        chat: GROUP,
        from: LEA,
        photo: [{ file_id: 'big', width: 800, height: 600, file_size: 30_000 }],
      },
    })
    await expect
      .poll(() => bot.calls.filter((call) => call.method === 'getUpdates').length)
      .toBeGreaterThan(3)
    await host.goto(app.url(`/admin/events/${event.slug}/moderation`))
    await host.getByRole('button', { name: fr.moderation.filterAll, exact: true }).click()
    await expect(host.getByTestId('moderation-card')).toHaveCount(1)

    // The token is in every Telegram URL the box called, and in nothing it answered to a browser.
    const settings = await host.request.get(app.url(`/api/events/${event.slug}/channels`))
    expect(await settings.text()).not.toContain(TOKEN)
  } finally {
    await context.close()
    await app.dispose()
    await bot.stop()
  }
})

test('a box with no bot has no Telegram switch and no panel', async ({ app, surfaces }) => {
  const { host } = surfaces
  const event = await app.seedEvent({ slug: 'sans-bot', name: 'Sans bot' })
  await signInAsHost(host, app)

  await host.goto(app.url(`/admin/events/${event.slug}/settings#messaging`))
  await expect(host.getByText(fr.admin.settingsPage.guests).first()).toBeVisible()
  await expect(host.getByLabel(fr.channels.allowTelegram)).toHaveCount(0)

  const reply = await host.request.get(app.url(`/api/events/${event.slug}/channels`))
  expect(await reply.json()).toMatchObject({ available: false, botUsername: null })
})
