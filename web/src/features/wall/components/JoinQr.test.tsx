import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { classesOf, cls } from '../../../testing/classesOf'
import { JoinQr } from './JoinQr'
import styles from './JoinQr.module.css'

describe('JoinQr', () => {
  it.each(['md', 'lg'] as const)('wears the plate class and the class of its %s size', (size) => {
    // The size is what separates the invitation on an empty wall from the corner reminder.
    const { container } = render(
      <JoinQr url="https://photos.example.com/join/H7K2QM" size={size} />,
    )

    expect(classesOf(container.firstElementChild)).toEqual([
      cls(styles, 'plate'),
      cls(styles, size),
    ])
  })

  it('is the corner reminder unless it is told otherwise', () => {
    const { container } = render(<JoinQr url="https://photos.example.com/join/H7K2QM" />)

    expect(classesOf(container.firstElementChild)).toEqual([
      cls(styles, 'plate'),
      cls(styles, 'md'),
    ])
  })
})
