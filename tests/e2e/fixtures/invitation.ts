import { csrfHeaders } from './app'
import type { Page } from '@playwright/test'
import type { TestApp } from './startTestApp'

/**
 * An event with a switched-on invitation, through the API exactly as the host's own page does
 * (spec 29): the party of Léa, in Paris, with a venue, a two-line address and a short word.
 * Returns the event and the invitation's link as the host sees it.
 */
export const invitedHost = async (
  page: Page,
  app: TestApp,
  slug: string,
): Promise<{ readonly event: { readonly slug: string }; readonly url: string }> => {
  const event = await app.seedEvent({ slug, name: 'Léa fête ses 40 ans' })
  const headers = await csrfHeaders(page.request, app)
  await page.request.put(app.url(`/api/events/${event.slug}/guest-invite`), {
    headers,
    data: {
      title: 'Léa fête ses 40 ans',
      startsAt: '2027-12-11T18:00:00Z',
      endsAt: '2027-12-12T01:00:00Z',
      timeZone: 'Europe/Paris',
      venueName: 'La Guinguette du Port',
      address: '12 quai de la Loire\n44000 Nantes',
      message: 'Apéro à 19 h, venez comme vous êtes.',
      language: 'fr',
    },
  })
  const enabled = await page.request.post(
    app.url(`/api/events/${event.slug}/guest-invite/enable`),
    { headers, data: {} },
  )
  const { guestInvite } = (await enabled.json()) as { guestInvite: { url: string } }
  return { event, url: guestInvite.url }
}
