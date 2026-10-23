import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClientSpacePage } from './ClientSpacePage'
import { fr } from '../../lib/i18n/fr'
import {
  aClientLimits,
  anAbout,
  fakeApi,
  renderWithProviders,
} from '../../testing/renderWithProviders'
import type { Api } from '../../lib/api/client'
import type { ClientAuditEntryDto, ClientLimitsDto, PendingInvitationDto } from '../../lib/api/dto'

/**
 * The page where an owner reads their own account (G2-16 / P3-17): limits, what waits for their
 * approval, and what the operator did. Only on a box with a client space, and only the caller's
 * own: the server answers for nobody else's, so what is held here is what the page does with
 * what it is given, and that a member who is not an owner is never shown the owner's half.
 */

const anInvitation = (overrides: Partial<PendingInvitationDto> = {}): PendingInvitationDto => ({
  id: 'inv-1',
  email: 'nouveau@example.org',
  role: 'member',
  createdAt: '2026-06-20T09:00:00.000Z',
  expiresAt: '2026-06-27T09:00:00.000Z',
  ...overrides,
})

const anEntry = (overrides: Partial<ClientAuditEntryDto> = {}): ClientAuditEntryDto => ({
  seq: 2,
  at: '2026-06-21T10:00:00.000Z',
  action: 'client.ceilingsChanged',
  actor: { kind: 'operator', label: null },
  subject: { type: 'client', id: 'client-1' },
  details: {},
  ...overrides,
})

const onBox = (limits: readonly ClientLimitsDto[], extra: Partial<Api> = {}) =>
  fakeApi({
    about: vi.fn(async () => anAbout({ features: { siteAdmin: true, forgotPassword: false } })),
    myLimits: vi.fn(async () => ({ clients: limits })),
    ...extra,
  })

const open = (api: Api) => renderWithProviders(<ClientSpacePage />, { api, route: '/admin/client' })

describe('ClientSpacePage', () => {
  it('shows an owner their limits with how much of each they have used', async () => {
    const limits = aClientLimits({
      meters: [{ kind: 'events', used: 9, max: 10, level: 'warning' }],
    })

    open(onBox([limits]))

    expect(await screen.findByRole('heading', { name: 'Atelier Alpha' })).toBeVisible()
    expect(screen.getAllByText(fr.clientSpace.eventsMeter(9, 10)).length).toBeGreaterThan(0)
    expect(
      screen.getByRole('progressbar', { name: fr.clientSpace.eventsMeter(9, 10) }),
    ).toBeVisible()
  })

  it('says so when the operator set no limit at all', async () => {
    open(onBox([aClientLimits({ meters: [] })]))

    expect((await screen.findAllByText(fr.clientSpace.noLimits)).length).toBeGreaterThan(0)
  })

  it('lists what waits for the owner, with whom it is for, and lets them approve it', async () => {
    const pendingInvitations = vi
      .fn()
      .mockResolvedValueOnce({ items: [anInvitation()] })
      .mockResolvedValue({ items: [] })
    const api = onBox([aClientLimits()], { pendingInvitations })

    open(api)

    expect(await screen.findByText('nouveau@example.org')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: fr.clientSpace.approve }))

    await waitFor(() => expect(api.approveInvitation).toHaveBeenCalledWith('inv-1'))
    expect(await screen.findByText(fr.clientSpace.pendingEmpty)).toBeVisible()
  })

  it('asks for the client it is showing, so an account in several clients gets each one’s own', async () => {
    const api = onBox([aClientLimits({ id: 'client-a' }), aClientLimits({ id: 'client-b' })])

    open(api)

    await waitFor(() => expect(api.pendingInvitations).toHaveBeenCalledTimes(2))
    expect(
      vi
        .mocked(api.pendingInvitations)
        .mock.calls.map(([id]) => id)
        .sort(),
    ).toEqual(['client-a', 'client-b'])
    expect(
      vi
        .mocked(api.clientAudit)
        .mock.calls.map(([query]) => query?.clientId)
        .sort(),
    ).toEqual(['client-a', 'client-b'])
  })

  it('reads the log in words and names no account: only the kind of actor', async () => {
    const clientAudit = vi.fn(async () => ({
      items: [
        anEntry({ seq: 3, action: 'invitation.issued', details: { pendingApproval: true } }),
        anEntry({ seq: 2, actor: { kind: 'integration', label: 'cloud:stripe-webhook' } }),
        anEntry({ seq: 1, action: 'something.new', actor: { kind: 'system', label: null } }),
      ],
      next: null,
    }))

    open(onBox([aClientLimits()], { clientAudit }))

    const log = await screen.findByRole('list', { name: '' })
    expect(log).toBeVisible()
    expect(await screen.findByText(fr.clientSpace.actionInvitationIssuedPending)).toBeVisible()
    expect(screen.getByText(fr.clientSpace.actionCeilingsChanged)).toBeVisible()
    expect(
      screen.getByText(`${fr.clientSpace.actorIntegration} · cloud:stripe-webhook`),
    ).toBeVisible()
    // An action this build has no sentence for is still a line, and not a hole in the log.
    expect(screen.getByText(fr.clientSpace.actionOther)).toBeVisible()
    expect(screen.getByText(fr.clientSpace.actorSystem)).toBeVisible()
  })

  it('carries on from the last line when the owner asks for older ones', async () => {
    const clientAudit = vi
      .fn()
      .mockResolvedValueOnce({ items: [anEntry({ seq: 2 })], next: 2 })
      .mockResolvedValueOnce({
        items: [anEntry({ seq: 1, action: 'client.periodReset' })],
        next: null,
      })
    const api = onBox([aClientLimits()], { clientAudit })

    open(api)
    await userEvent.click(await screen.findByRole('button', { name: fr.clientSpace.auditMore }))

    expect(await screen.findByText(fr.clientSpace.actionPeriodReset)).toBeVisible()
    expect(clientAudit).toHaveBeenLastCalledWith({ clientId: 'client-1', before: 2 })
    expect(screen.queryByRole('button', { name: fr.clientSpace.auditMore })).toBeNull()
  })

  it('says the log is empty rather than showing nothing', async () => {
    open(onBox([aClientLimits()]))

    expect(await screen.findByText(fr.clientSpace.auditEmpty)).toBeVisible()
  })

  it('shows a member who is not an owner the limits and neither the approvals nor the log', async () => {
    const api = onBox([aClientLimits({ role: 'member' })])

    open(api)

    expect(await screen.findByRole('heading', { name: 'Atelier Alpha' })).toBeVisible()
    expect(screen.queryByText(fr.clientSpace.pendingTitle)).toBeNull()
    expect(screen.queryByText(fr.clientSpace.auditTitle)).toBeNull()
    expect(api.pendingInvitations).not.toHaveBeenCalled()
    expect(api.clientAudit).not.toHaveBeenCalled()
  })

  it('shows the suspension of a client above its limits', async () => {
    open(onBox([aClientLimits({ suspended: true })]))

    const title = await screen.findByText(fr.clientSpace.suspendedTitle)
    expect(title.closest('[role="status"]')).not.toBeNull()
  })
})
