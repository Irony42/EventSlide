import { csrfHeaders, expect, test } from '../fixtures/app'
import { invitedHost } from '../fixtures/invitation'
import { fr } from '../../../web/src/lib/i18n/fr'

/**
 * The replies page stays readable with every column the form can ask (spec 30), on a laptop.
 *
 * What no cheaper ring can answer: **how a real browser lays the table out**. jsdom has no layout,
 * and the defects this guards were all geometry: with companions, menus, a diet, a question and a
 * word, the table outgrew its frame and every column fell to its longest word ("Volaill / e" before
 * #566, a guest's word one word a line after it), a row grew a screen tall, the far columns were cut
 * off with the name scrolled out of sight; and in "Traiteur" a long diet fell under its name, where
 * it read as the heading of the lines below.
 *
 * The replies go in through the host's own "add a reply", so nothing here waits on a phone. The
 * assertions measure boxes, not pixels. Only `chromium-desktop` runs it, at a 1024 and a 1440 screen.
 */

const list = fr.rsvp.list

// Playwright insists on a destructured first argument.
// eslint-disable-next-line no-empty-pattern
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'the desktop run')
})

const QUESTION = 'Une chanson pour la piste ?'
const LONG_DIET = 'Un enfant allergique aux fruits à coque'

for (const width of [1024, 1440]) {
  test(`at ${width} px the replies table keeps its rows short and its names in view, and a diet stays beside its name`, async ({
    app,
    surfaces,
  }) => {
    const { host } = surfaces
    await host.setViewportSize({ width, height: 900 })
    const { event } = await invitedHost(host, app, `fete-colonnes-${width}`)
    const headers = await csrfHeaders(host.request, app)
    const saved = await host.request.put(app.url(`/api/events/${event.slug}/rsvp-form`), {
      headers,
      data: {
        enabled: true,
        form: {
          partySize: { enabled: true, max: 8 },
          kidsSeparate: true,
          diet: true,
          companionNames: true,
          meals: { enabled: true, options: ['Volaille', 'Végétarien'] },
          questions: [{ label: QUESTION, kind: 'text' }],
        },
      },
    })
    expect(saved.status()).toBe(200)
    const { rsvpForm } = (await saved.json()) as {
      rsvpForm: { form: { questions: { id: string }[] } }
    }
    const questionId = rsvpForm.form.questions[0]?.id as string

    const replies = [
      {
        name: 'Famille Okafor',
        answer: 'yes',
        adults: 3,
        kids: 2,
        companions: ['Chidi', 'Ada', 'Emeka', 'Zara'],
        meals: ['Volaille', 'Volaille', 'Volaille', 'Végétarien', 'Volaille'],
        diet: LONG_DIET,
        answers: [{ questionId, value: 'Girls Just Want to Have Fun' }],
        message: 'On vient avec les enfants, merci pour la table, on a hâte de vous voir !',
      },
      {
        name: 'Lise Charpentier',
        answer: 'no',
        message: 'Impossible ce week-end, bises à tous les deux, on pense fort à vous.',
      },
    ]
    for (const reply of replies) {
      const added = await host.request.post(app.url(`/api/events/${event.slug}/rsvps`), {
        headers,
        data: reply,
      })
      expect(added.status()).toBe(201)
    }

    await host.goto(app.url(`/admin/events/${event.slug}/rsvps`))
    const table = host.getByRole('table')
    await expect(table.getByRole('columnheader', { name: QUESTION })).toBeVisible()
    const okafor = table.getByRole('row', { name: /Famille Okafor/ })
    // Four poultry and one vegetarian are one line of the menus column, not five.
    await expect(okafor).toContainText('Volaille × 4, Végétarien')

    // A row is a few lines, never a column of single words: the guest's word included.
    const lineHeight = await table.evaluate(
      (element) => parseFloat(getComputedStyle(element).lineHeight) || 20,
    )
    for (const name of [/Famille Okafor/, /Lise Charpentier/]) {
      const box = await table.getByRole('row', { name }).boundingBox()
      expect(box?.height ?? Infinity).toBeLessThanOrEqual(lineHeight * 5)
    }

    // The frame scrolls sideways, and the name stays where it was while the far columns come in.
    const frame = table.locator('xpath=..')
    const nameCell = okafor.getByRole('rowheader')
    const before = await nameCell.boundingBox()
    await frame.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
    const received = okafor.getByRole('cell').last()
    await expect(received).toBeInViewport()
    const after = await nameCell.boundingBox()
    expect(after?.x).toBe(before?.x)
    const frameBox = await frame.boundingBox()
    const receivedBox = await received.boundingBox()
    expect((receivedBox?.x ?? 0) + (receivedBox?.width ?? 0)).toBeLessThanOrEqual(
      (frameBox?.x ?? 0) + (frameBox?.width ?? 0) + 1,
    )

    // Traiteur: the long diet wraps in its own column, its first line level with the name.
    const caterer = host.getByRole('region', { name: list.catererTitle })
    const term = caterer.locator('dt', { hasText: 'Famille Okafor' })
    const diet = caterer.locator('dd', { hasText: LONG_DIET })
    const termBox = await term.boundingBox()
    const dietBox = await diet.boundingBox()
    expect(dietBox?.x ?? 0).toBeGreaterThan((termBox?.x ?? 0) + (termBox?.width ?? 0) - 1)
    expect(Math.abs((dietBox?.y ?? 0) - (termBox?.y ?? 0))).toBeLessThan(lineHeight / 2)
  })
}
