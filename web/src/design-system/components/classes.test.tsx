import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Button, type ButtonVariant } from './Button'
import { Card } from './Card'
import { Spinner, type SpinnerProps } from './Spinner'
import { TextInput } from './TextInput'
import buttonStyles from './Button.module.css'
import cardStyles from './Card.module.css'
import inputStyles from './TextInput.module.css'
import spinnerStyles from './Spinner.module.css'
import { classesOf, cls } from '../../testing/classesOf'

/**
 * The classes a primitive wears, in the order it wears them.
 *
 * `cx` replaced three hand-written spellings in these components, and what it must not do
 * is drop a class, move one, or print one that is not there. A stylesheet's classes are
 * hashed, so each is read off the module the component itself imports rather than spelled
 * here — which also fails the day a class is renamed in the stylesheet and not in the
 * component.
 */

describe('Button', () => {
  it('wears its own classes in order, and the caller’s after them', () => {
    const { container } = render(
      <Button variant="primary" size="lg" className="mine">
        Envoyer
      </Button>,
    )

    expect(classesOf(container.firstElementChild)).toEqual([
      cls(buttonStyles, 'button'),
      cls(buttonStyles, 'primary'),
      cls(buttonStyles, 'lg'),
      'mine',
    ])
  })

  it('takes the full-width class only when it is asked to be a block', () => {
    const { container: block } = render(<Button block>Envoyer</Button>)
    const { container: inline } = render(<Button>Envoyer</Button>)

    expect(classesOf(block.firstElementChild)).toContain(cls(buttonStyles, 'block'))
    expect(classesOf(inline.firstElementChild)).not.toContain(cls(buttonStyles, 'block'))
  })

  it('prints no class for a variant its stylesheet does not have', () => {
    // The template-literal spelling this replaced wrote the word "undefined" into the
    // attribute here.
    const { container } = render(<Button variant={'missing' as ButtonVariant}>Envoyer</Button>)

    expect(container.firstElementChild?.getAttribute('class')).not.toContain('undefined')
    expect(classesOf(container.firstElementChild)).toContain(cls(buttonStyles, 'button'))
  })
})

describe('TextInput', () => {
  it('takes the code class for the join code and for nothing else', () => {
    const { container: code } = render(<TextInput variant="code" aria-label="Code" />)
    const { container: text } = render(<TextInput aria-label="Nom" />)

    expect(classesOf(code.firstElementChild)).toEqual([
      cls(inputStyles, 'input'),
      cls(inputStyles, 'code'),
    ])
    expect(classesOf(text.firstElementChild)).toEqual([cls(inputStyles, 'input')])
  })

  it('keeps the caller’s class after its own', () => {
    const { container } = render(<TextInput aria-label="Nom" className="mine" />)

    expect(classesOf(container.firstElementChild).at(-1)).toBe('mine')
  })
})

describe('Card', () => {
  it('keeps the caller’s class after its own', () => {
    const { container } = render(<Card className="mine">contenu</Card>)

    expect(classesOf(container.firstElementChild)).toEqual([cls(cardStyles, 'card'), 'mine'])
  })

  it('wears only its own when the caller adds none', () => {
    const { container } = render(<Card>contenu</Card>)

    expect(classesOf(container.firstElementChild)).toEqual([cls(cardStyles, 'card')])
  })
})

describe('Spinner', () => {
  it.each(['sm', 'md', 'lg'] as const)('wears the class of its %s size after its own', (size) => {
    const { container } = render(<Spinner size={size} />)

    expect(classesOf(container.firstElementChild)).toEqual([
      cls(spinnerStyles, 'spinner'),
      cls(spinnerStyles, size),
    ])
  })

  it('prints no class for a size its stylesheet does not have', () => {
    const { container } = render(<Spinner size={'xl' as NonNullable<SpinnerProps['size']>} />)

    expect(container.firstElementChild?.getAttribute('class')).not.toContain('undefined')
    expect(classesOf(container.firstElementChild)).toEqual([cls(spinnerStyles, 'spinner')])
  })
})
