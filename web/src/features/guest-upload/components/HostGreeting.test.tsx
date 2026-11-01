import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HostGreeting } from './HostGreeting'

describe('HostGreeting', () => {
  it.each([[null], [undefined], ['']])('draws nothing for %o', (message) => {
    render(<HostGreeting message={message} />)

    expect(screen.queryByTestId('host-greeting')).toBeNull()
  })

  it('writes a tag as the characters typed, never as markup', () => {
    render(<HostGreeting message="<img src=x onerror=alert(1)>" variant="compact" />)

    expect(screen.getByTestId('host-greeting').textContent).toBe('<img src=x onerror=alert(1)>')
    expect(document.querySelector('img')).toBeNull()
  })
})
