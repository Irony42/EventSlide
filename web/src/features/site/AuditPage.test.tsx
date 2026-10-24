import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fr } from '../../lib/i18n/fr'
import { ApiError } from '../../lib/http'
import type { Api } from '../../lib/api/client'
import type { SiteAuditEntryDto } from '../../lib/api/dto'
import { aSiteAuditEntry, aSiteClient, CLIENT_ID, OPERATOR_ID } from '../../testing/siteFixtures'
import {
  consoleApi,
  NEVER_FROM_THE_CONSOLE,
  notTheOperator,
  openConsole,
} from '../../testing/siteConsole'

/**
 * The box's log, newest first, and one client's slice of it.
 *
 * Ring 5, through the route table. What this screen owes is to read the log in words and to print
 * the operator's own reason as text, never as markup, and never to guess: a line written under a
 * name this build does not know is still a line.
 */

const withLog = (entries: readonly SiteAuditEntryDto[], extra: Partial<Api> = {}) =>
  consoleApi({
    siteAudit: vi.fn(async () => ({ items: entries, next: null })),
    siteClients: vi.fn(async () => ({ items: [aSiteClient()], next: null })),
    ...extra,
  })

describe('the console’s log', () => {
  it('waits, saying so, while the first page is on its way', async () => {
    openConsole(
      '/admin/site/audit',
      consoleApi({ siteAudit: vi.fn(() => new Promise<never>(() => {})) }),
    )

    await screen.findByRole('heading', { name: fr.site.auditTitle })
    expect(screen.getByRole('status')).toHaveTextContent(fr.app.loading)
  })

  it('says nothing was recorded rather than showing an empty list', async () => {
    openConsole('/admin/site/audit', withLog([]))

    expect(await screen.findByRole('heading', { name: fr.site.auditEmpty })).toBeVisible()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('says it could not read the log, with a retry that reads it again', async () => {
    const siteAudit = vi
      .fn<Api['siteAudit']>()
      .mockRejectedValueOnce(new ApiError(500, 'server.unexpected'))
      .mockResolvedValue({ items: [aSiteAuditEntry()], next: null })
    openConsole('/admin/site/audit', consoleApi({ siteAudit }))

    const failure = await screen.findByRole('alert')
    await userEvent.click(within(failure).getByRole('button', { name: fr.app.retry }))

    expect(await screen.findByText(fr.site.actions['client.suspended'])).toBeVisible()
  })

  it('shows the server’s refusal, and no log, to an account the server does not let in', async () => {
    openConsole(
      '/admin/site/audit',
      consoleApi({ siteAudit: vi.fn(async () => Promise.reject(notTheOperator())) }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(fr.errors['auth.forbidden'])
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('reads each line in words: when, what, who did it, and which client it is about', async () => {
    openConsole('/admin/site/audit', withLog([aSiteAuditEntry()]))

    const line = within(await screen.findByRole('listitem'))

    expect(line.getByText(fr.site.actions['client.suspended'])).toBeVisible()
    expect(line.getByText(/Opérateur · compte 11111111/)).toBeVisible()
    expect(line.getByRole('link', { name: /Atelier Alpha/ })).toHaveAttribute(
      'href',
      `/admin/site/clients/${CLIENT_ID}`,
    )
    expect(line.getByText(/2026|26/)).toBeVisible()
  })

  it('names the kind of actor alone for a line no account wrote', async () => {
    openConsole(
      '/admin/site/audit',
      withLog([aSiteAuditEntry({ actor: { kind: 'system', userId: null, label: null } })]),
    )

    expect(await screen.findByText(fr.site.actors.system)).toBeVisible()
  })

  it('prints the operator’s reason for a change of ceilings, as text', async () => {
    openConsole(
      '/admin/site/audit',
      withLog([
        aSiteAuditEntry({
          action: 'client.ceilingsChanged',
          details: { reason: '<b>Capacité</b> & <script>x</script>' },
        }),
      ]),
    )

    expect(
      await screen.findByText(fr.site.auditReason('<b>Capacité</b> & <script>x</script>')),
    ).toBeVisible()
    expect(document.querySelector('b, script')).toBeNull()
  })

  it('says an invitation is waiting for an owner when its details say so', async () => {
    openConsole(
      '/admin/site/audit',
      withLog([
        aSiteAuditEntry({
          action: 'invitation.issued',
          subject: { type: 'invitation', id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' },
          details: { pendingApproval: true },
        }),
      ]),
    )

    expect(await screen.findByText(fr.site.actionInvitationIssuedPending)).toBeVisible()
  })

  it('still shows a line written under a name this build does not know', async () => {
    openConsole('/admin/site/audit', withLog([aSiteAuditEntry({ action: 'something.new' })]))

    expect(await screen.findByText(fr.site.actionOther)).toBeVisible()
  })

  it('puts the start of the client’s id in place of its name when the listing cannot be read, and still shows the log', async () => {
    openConsole(
      '/admin/site/audit',
      withLog([aSiteAuditEntry()], {
        siteClients: vi.fn(async () => Promise.reject(new ApiError(500, 'server.unexpected'))),
      }),
    )

    expect(await screen.findByRole('link', { name: /aaaaaaaa/ })).toBeVisible()
  })

  it('shows one client’s slice, says so, and offers the whole log', async () => {
    const api = withLog([aSiteAuditEntry()])
    openConsole(`/admin/site/audit?clientId=${CLIENT_ID}`, api)

    expect(await screen.findByText(fr.site.auditFiltered)).toBeVisible()
    expect(api.siteAudit).toHaveBeenCalledWith({ clientId: CLIENT_ID }, expect.anything())
    expect(screen.getByRole('link', { name: fr.site.auditShowAll })).toHaveAttribute(
      'href',
      '/admin/site/audit',
    )
  })

  it('asks for the whole log when no client is named', async () => {
    const api = withLog([aSiteAuditEntry()])
    openConsole('/admin/site/audit', api)

    await screen.findByRole('listitem')

    expect(api.siteAudit).toHaveBeenCalledWith({}, expect.anything())
    expect(screen.queryByText(fr.site.auditFiltered)).toBeNull()
  })

  it('reads older lines with the bound the server gave, and keeps the lines already read', async () => {
    const siteAudit = vi
      .fn<Api['siteAudit']>()
      .mockResolvedValueOnce({ items: [aSiteAuditEntry({ seq: 17 })], next: 16 })
      .mockResolvedValueOnce({
        items: [aSiteAuditEntry({ seq: 16, action: 'client.resumed' })],
        next: null,
      })
    openConsole('/admin/site/audit', withLog([], { siteAudit }))

    await userEvent.click(await screen.findByRole('button', { name: fr.site.auditMore }))

    expect(await screen.findByText(fr.site.actions['client.resumed'])).toBeVisible()
    expect(screen.getByText(fr.site.actions['client.suspended'])).toBeVisible()
    expect(siteAudit).toHaveBeenLastCalledWith({ before: 16 }, undefined)
    expect(screen.queryByRole('button', { name: fr.site.auditMore })).toBeNull()
  })

  it('prints no account but by the start of its id, and nothing a person made', async () => {
    const planted = {
      ...aSiteAuditEntry({ actor: { kind: 'operator', userId: OPERATOR_ID, label: null } }),
      email: 'planted@contact.example',
      caption: 'PLANTED-CAPTION',
    }
    openConsole('/admin/site/audit', withLog([planted]))

    await screen.findByRole('listitem')

    expect(document.body).not.toHaveTextContent(/PLANTED|planted@/)
    expect(document.body).not.toHaveTextContent(OPERATOR_ID)
  })

  it('draws no photograph and asks for nothing outside the operator’s namespace', async () => {
    const api = withLog([aSiteAuditEntry()])

    const { container } = openConsole('/admin/site/audit', api)
    await screen.findByRole('listitem')

    expect(container.querySelectorAll('img, video, picture, canvas, audio')).toHaveLength(0)
    for (const method of NEVER_FROM_THE_CONSOLE) {
      expect(api[method], `${method} was asked for`).not.toHaveBeenCalled()
    }
  })
})
