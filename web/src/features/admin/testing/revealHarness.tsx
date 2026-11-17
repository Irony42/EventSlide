import { vi } from 'vitest'
import {
  anEventDto,
  eventSettings,
  fakeApi,
  renderWithProviders,
} from '../../../testing/renderWithProviders'
import { RevealControls } from './RevealControls'
import type { Api } from '../../../lib/api/client'
import type { EventDto } from '../../../lib/api/dto'

export const SLUG = 'camille-et-sacha'
export const NOW = new Date('2026-06-20T21:00:00.000Z').getTime()
export const MINUTE = 60_000
export const HOUR = 60 * MINUTE

interface HeldInput {
  /** The hour as milliseconds after the server's clock, or `null` for "at the button". */
  readonly inMs?: number | null
  /** How far this laptop's clock is ahead of the server's. */
  readonly laptopAheadMs?: number
  readonly readyCount?: number | null
  readonly pendingCount?: number
  readonly revealed?: boolean
  readonly status?: EventDto['status']
  readonly scheduledCloseAt?: string | null
}

/** An evening held back by the gate, as the server answers it at `serverNowMs`. */
export const held = ({
  inMs = 2 * HOUR + 10 * MINUTE,
  readyCount = 128,
  pendingCount = 14,
  revealed = false,
  status = 'live',
  scheduledCloseAt = null,
}: HeldInput = {}): EventDto => {
  const atMs = inMs === null ? null : NOW + inMs
  return anEventDto({
    status,
    pendingCount,
    scheduledCloseAt,
    settings: eventSettings({
      reveal: {
        enabled: true,
        at: atMs === null ? null : new Date(atMs).toISOString(),
        film: true,
      },
    }),
    reveal: {
      enabled: true,
      revealed,
      atMs,
      serverNowMs: NOW,
      film: true,
      readyCount: revealed ? null : readyCount,
    },
  })
}

export interface RenderRevealOptions {
  readonly api?: Api
  readonly onChanged?: (event: EventDto) => void
  readonly onReload?: () => void
  readonly settingsPath?: string | null
  /** The banner at the top of the page, which most tests of the section do not want to share a button with. */
  readonly banner?: boolean
}

export const renderReveal = (
  event: EventDto,
  { api = fakeApi(), ...props }: RenderRevealOptions = {},
) => {
  const onChanged = props.onChanged ?? vi.fn()
  const onReload = props.onReload ?? vi.fn()
  const view = renderWithProviders(
    <RevealControls
      event={event}
      onChanged={onChanged}
      onReload={onReload}
      withBanner={props.banner === true}
      settingsPath={
        props.settingsPath === undefined ? '/admin/events/x/settings' : props.settingsPath
      }
    />,
    { api },
  )
  return { ...view, onChanged, onReload, api }
}
