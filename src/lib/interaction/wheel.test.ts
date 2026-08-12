import { describe, expect, it } from 'vitest'

import {
  accumulateWheelDelta,
  aggregateWheelDeltas,
  EMPTY_WHEEL_DELTA,
  normalizeWheelDelta,
  wheelDeltaToScrollAction,
} from './wheel'

describe('wheel helpers', () => {
  it('normalizes line and page delta modes to pixels', () => {
    expect(
      normalizeWheelDelta(
        { deltaX: 1, deltaY: -2, deltaMode: 1 },
        { pixelsPerLine: 20 },
      ),
    ).toEqual({ x: 20, y: -40 })
    expect(
      normalizeWheelDelta(
        { deltaX: 0, deltaY: 1, deltaMode: 2 },
        { pixelsPerPage: 600 },
      ),
    ).toEqual({ x: 0, y: 600 })
  })

  it('accumulates events without mutating the prior total', () => {
    const total = accumulateWheelDelta(EMPTY_WHEEL_DELTA, {
      deltaX: 0,
      deltaY: 30,
    })
    const next = accumulateWheelDelta(total, { deltaX: 5, deltaY: 40 })
    expect(total).toEqual({ x: 0, y: 30 })
    expect(next).toEqual({ x: 5, y: 70 })
    expect(
      aggregateWheelDeltas([
        { deltaX: 2, deltaY: 4 },
        { deltaX: 3, deltaY: -1 },
      ]),
    ).toEqual({ x: 5, y: 3 })
  })

  it('chooses the dominant axis and maps its sign to direction', () => {
    expect(wheelDeltaToScrollAction({ x: 20, y: -110 })).toEqual({
      direction: 'up',
      amount: 1,
    })
    expect(wheelDeltaToScrollAction({ x: 250, y: 10 })).toEqual({
      direction: 'right',
      amount: 3,
    })
  })

  it('limits the amount and ignores sub-threshold or invalid input', () => {
    expect(
      wheelDeltaToScrollAction(
        { x: 0, y: 10_000 },
        { maxAmount: 6 },
      ),
    ).toEqual({ direction: 'down', amount: 6 })
    expect(
      wheelDeltaToScrollAction({ x: 0, y: 0.2 }, { minDelta: 1 }),
    ).toBeNull()
    expect(wheelDeltaToScrollAction({ x: Number.NaN, y: 2 })).toBeNull()
  })
})
