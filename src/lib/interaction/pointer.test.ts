import { describe, expect, it } from 'vitest'

import {
  classifyPointerGesture,
  hasExceededDragThreshold,
  isDoubleClickCandidate,
} from './pointer'

describe('pointer gesture helpers', () => {
  it('starts a drag at the five-pixel Euclidean threshold', () => {
    expect(hasExceededDragThreshold({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(
      false,
    )
    expect(hasExceededDragThreshold({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(
      true,
    )
    expect(classifyPointerGesture({ x: 4, y: 8 }, { x: 7, y: 12 })).toBe(
      'drag',
    )
  })

  it('supports a caller-selected threshold', () => {
    expect(
      classifyPointerGesture({ x: 0, y: 0 }, { x: 9, y: 0 }, 10),
    ).toBe('click')
  })

  it('recognizes nearby clicks within 250 ms as a double click', () => {
    const first = { x: 100, y: 100, time: 1_000, button: 0 }
    expect(
      isDoubleClickCandidate(first, {
        x: 103,
        y: 104,
        time: 1_250,
        button: 0,
      }),
    ).toBe(true)
    expect(
      isDoubleClickCandidate(first, {
        x: 103,
        y: 104,
        time: 1_251,
        button: 0,
      }),
    ).toBe(false)
  })

  it('rejects different buttons, distant clicks and reversed clocks', () => {
    const first = { x: 0, y: 0, time: 100, button: 0 }
    expect(
      isDoubleClickCandidate(first, { x: 0, y: 0, time: 101, button: 2 }),
    ).toBe(false)
    expect(
      isDoubleClickCandidate(first, { x: 6, y: 0, time: 101, button: 0 }),
    ).toBe(false)
    expect(
      isDoubleClickCandidate(first, { x: 0, y: 0, time: 99, button: 0 }),
    ).toBe(false)
  })
})
