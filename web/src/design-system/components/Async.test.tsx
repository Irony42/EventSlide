import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Async, LoadFailure, Pending, type AsyncState } from './Async'
import { fr } from '../../lib/i18n/fr'

/**
 * The four screens every read owes its reader, and the order they are decided in.
 *
 * The pages built on it assert what each screen says. What is pinned here is the switch
 * itself: which state wins when two are true at once, and that "nothing has been asked yet"
 * is never read as "the list is empty".
 */

const stateOf = <T,>(overrides: Partial<AsyncState<T>> = {}): AsyncState<T> => ({
  data: null,
  loading: false,
  error: null,
  reload: () => undefined,
  ...overrides,
})

const names = (rows: readonly string[]) => (
  <ul>
    {rows.map((row) => (
      <li key={row}>{row}</li>
    ))}
  </ul>
)

describe('Async: the wait', () => {
  it('says the screen is working, aloud, in the generic words by default', () => {
    render(<Async state={stateOf<string[]>({ loading: true })}>{names}</Async>)

    expect(screen.getByRole('status')).toHaveTextContent(fr.app.loading)
  })

  it('says what is being waited for when the page names it', () => {
    render(
      <Async state={stateOf<string[]>({ loading: true })} label="Chargement de vos évènements…">
        {names}
      </Async>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Chargement de vos évènements…')
  })

  it('wins over a failure and over the answer it is about to replace', () => {
    // A refresh shows the wait and not the page it is replacing; a retry shows the wait and
    // not the sentence it was pressed on.
    const children = vi.fn(names)
    render(
      <Async state={stateOf({ loading: true, error: 'Hors ligne', data: ['Camille'] })}>
        {children}
      </Async>,
    )

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(children).not.toHaveBeenCalled()
  })
})

describe('Async: the failure', () => {
  it('names it with the reader’s own sentence and offers to ask again', async () => {
    const reload = vi.fn()
    render(
      <Async state={stateOf<string[]>({ error: 'La connexion a échoué.', reload })}>{names}</Async>,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(fr.app.loadFailed)
    expect(alert).toHaveTextContent('La connexion a échoué.')

    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('wins over the answer a failed refresh left behind', () => {
    // The reader is told the refresh failed, instead of being shown a page that may be out of
    // date as though it were current.
    const children = vi.fn(names)
    render(<Async state={stateOf({ error: 'Hors ligne', data: ['Camille'] })}>{children}</Async>)

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(children).not.toHaveBeenCalled()
  })

  it('keeps the heading level the page asks for, so its outline stays correct', () => {
    render(<Async state={stateOf<string[]>({ error: 'Hors ligne' })}>{names}</Async>)
    expect(screen.getByRole('heading', { level: 2, name: fr.app.loadFailed })).toBeInTheDocument()
  })

  it('takes a lower level inside a card', () => {
    render(
      <Async state={stateOf<string[]>({ error: 'Hors ligne' })} as="h3">
        {names}
      </Async>,
    )
    expect(screen.getByRole('heading', { level: 3, name: fr.app.loadFailed })).toBeInTheDocument()
  })
})

describe('Async: nothing, and no answer yet', () => {
  it('shows the empty state only for an answer that is an empty list', () => {
    const children = vi.fn(names)
    render(
      <Async state={stateOf<string[]>({ data: [] })} empty={<p>Aucun invité.</p>}>
        {children}
      </Async>,
    )

    expect(screen.getByText('Aucun invité.')).toBeInTheDocument()
    expect(children).not.toHaveBeenCalled()
  })

  it('does not take "nothing has been asked yet" for an empty list', () => {
    // 1.0 rendered the same nothing for loading, failed and empty, and a host with a
    // projector waiting could not tell a working screen from a broken one.
    const children = vi.fn(names)
    const { container } = render(
      <Async state={stateOf<string[]>()} empty={<p>Aucun invité.</p>}>
        {children}
      </Async>,
    )

    expect(screen.queryByText('Aucun invité.')).toBeNull()
    expect(children).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })

  it('hands an empty list to the page when the page has no empty state of its own', () => {
    const children = vi.fn(names)
    render(<Async state={stateOf<string[]>({ data: [] })}>{children}</Async>)

    expect(children).toHaveBeenCalledWith([])
  })

  it('does not read an answer that is not a list as an empty one', () => {
    // Only a list can be empty. A record is the page's to interpret, however bare it is.
    render(
      <Async state={stateOf({ data: { link: null } })} empty={<p>Aucun lien.</p>}>
        {(status) => <p>{status.link === null ? 'Pas de lien.' : 'Un lien.'}</p>}
      </Async>,
    )

    expect(screen.getByText('Pas de lien.')).toBeInTheDocument()
    expect(screen.queryByText('Aucun lien.')).toBeNull()
  })
})

describe('Async: the answer', () => {
  it('hands it to the page, and shows nothing else', () => {
    render(
      <Async state={stateOf({ data: ['Camille', 'Sacha'] })} empty={<p>Aucun invité.</p>}>
        {names}
      </Async>,
    )

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Camille',
      'Sacha',
    ])
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Aucun invité.')).toBeNull()
  })
})

describe('Pending and LoadFailure on their own', () => {
  it('Pending is a labelled status', () => {
    render(<Pending label="Chargement de l’évènement…" />)

    expect(screen.getByRole('status')).toHaveTextContent('Chargement de l’évènement…')
  })

  it('LoadFailure is an alert that says what failed and offers the retry', async () => {
    const onRetry = vi.fn()
    render(<LoadFailure message="Le serveur ne répond pas." onRetry={onRetry} as="h1" />)

    expect(screen.getByRole('alert')).toHaveTextContent('Le serveur ne répond pas.')
    expect(screen.getByRole('heading', { level: 1, name: fr.app.loadFailed })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: fr.app.retry }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
