import { Profiler } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fr } from '../../../lib/i18n/fr'
import { LocaleProvider } from '../../../lib/i18n/LocaleProvider'
import { aWallAnnouncement } from '../../../testing/renderWithProviders'
import styles from './WallAnnouncementPill.module.css'
import { WallAnnouncementPill } from './WallAnnouncementPill'

const AT = Date.parse('2026-11-16T21:00:00.000Z')

/** A discreet announcement that started at `AT` and stays `durationSeconds`. */
const discreet = (durationSeconds = 900, text = 'Le buffet est ouvert') =>
  aWallAnnouncement(AT, { kind: 'discreet', countdownSeconds: 0, durationSeconds, text })

const mount = (announcement = discreet()) => {
  const now = () => Date.now()
  const view = render(
    <LocaleProvider initialLocale="fr">
      <WallAnnouncementPill announcement={announcement} now={now} />
    </LocaleProvider>,
  )
  return {
    ...view,
    update: (next: typeof announcement) =>
      view.rerender(
        <LocaleProvider initialLocale="fr">
          <WallAnnouncementPill announcement={next} now={now} />
        </LocaleProvider>,
      ),
  }
}

const reducedMotion = (): void => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  )
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

const pill = (): Element => {
  const found = document.querySelector('[data-wall-announcement-pill]')
  if (found === null) throw new Error('no pill')
  return found
}

describe('WallAnnouncementPill (spec 21)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(AT)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shows the sentence over the time left, rounded up to the minute', () => {
    mount()

    expect(screen.getByText('Le buffet est ouvert')).toBeInTheDocument()
    expect(screen.getByText(fr.wall.announcementMinutesLeft(15))).toBeInTheDocument()
  })

  it('rounds the minute up: 11 min 59 s left reads 12', () => {
    vi.setSystemTime(AT + 3 * 60_000 + 1_000)
    mount()

    expect(screen.getByText(fr.wall.announcementMinutesLeft(12))).toBeInTheDocument()
  })

  it('says "moins d’1 min" in the last minute, and never "encore 1 min"', () => {
    vi.setSystemTime(AT + 900_000 - 60_000)
    mount()

    expect(screen.getByText(fr.wall.announcementLastMinute)).toBeInTheDocument()
    expect(screen.queryByText(/encore/)).toBeNull()
  })

  it('changes the figure once a minute, on the minute boundary, with one timer', async () => {
    mount(discreet(300))
    expect(screen.getByText(fr.wall.announcementMinutesLeft(5))).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(1)

    await advance(59_999)
    expect(screen.getByText(fr.wall.announcementMinutesLeft(5))).toBeInTheDocument()

    await advance(1)
    expect(screen.getByText(fr.wall.announcementMinutesLeft(4))).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(1)

    await advance(120_000)
    expect(screen.getByText(fr.wall.announcementMinutesLeft(2))).toBeInTheDocument()

    await advance(60_000)
    expect(screen.getByText(fr.wall.announcementLastMinute)).toBeInTheDocument()
    // Nothing more to change in the last minute: no timer left running.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('renders once a minute, on the boundary, and not once a second', async () => {
    let renders = 0
    render(
      <LocaleProvider initialLocale="fr">
        <Profiler id="pill" onRender={() => (renders += 1)}>
          <WallAnnouncementPill announcement={discreet(600)} now={() => Date.now()} />
        </Profiler>
      </LocaleProvider>,
    )

    for (let minute = 1; minute <= 3; minute += 1) {
      const before = renders
      await advance(59_999)
      expect(renders).toBe(before)
      await advance(1)
      expect(renders).toBe(before + 1)
    }
  })

  it('clears its timer when it is taken down', () => {
    const view = mount(discreet(600))
    expect(vi.getTimerCount()).toBe(1)

    view.unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('tells a screen reader once, and the time left is not a live region', async () => {
    mount(discreet(300))
    const live = '[role=status], [aria-live]'

    const status = pill().querySelector('[role="status"]')
    expect(status).toHaveTextContent(fr.wall.announcementSay('Le buffet est ouvert'))
    const visible = pill().querySelector('[aria-hidden="true"]')
    expect(visible).toHaveTextContent('encore 5 min')
    expect(visible?.matches(live)).toBe(false)
    expect(visible?.querySelector(live)).toBeNull()
    expect(pill().querySelectorAll(live)).toHaveLength(1)

    await advance(60_000)

    expect(visible).toHaveTextContent('encore 4 min')
    expect(status).toHaveTextContent(fr.wall.announcementSay('Le buffet est ouvert'))
  })

  it('changes the text in place: the same element, nothing mounted again', () => {
    const view = mount()
    const before = pill()

    view.update({ ...discreet(), text: 'Le buffet ferme à minuit' })

    expect(pill()).toBe(before)
    expect(pill()).toHaveTextContent('Le buffet ferme à minuit')
    expect(pill()).not.toHaveTextContent('Le buffet est ouvert')
  })

  it('prints the host’s text as text, never as markup', () => {
    mount(discreet(900, '<b>gras</b>'))

    expect(pill().querySelector('b')).toBeNull()
    expect(screen.getByText('<b>gras</b>')).toBeInTheDocument()
  })

  it('has a 250 ms entrance, and none under prefers-reduced-motion', () => {
    const { unmount } = mount()
    expect(pill().className).toContain(styles['enters'])
    unmount()

    reducedMotion()
    mount()
    expect(pill().className).not.toContain(styles['enters'])
  })
})
