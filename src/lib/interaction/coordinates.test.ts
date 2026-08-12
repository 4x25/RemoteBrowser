import { describe, expect, it } from 'vitest'

import { mapClientPointToRemote } from './coordinates'

const imageRect = { left: 100, top: 50, width: 800, height: 450 }
const viewport = { width: 1440, height: 900 }

describe('mapClientPointToRemote', () => {
  it('maps the rendered image position into remote CSS pixels', () => {
    expect(
      mapClientPointToRemote({ x: 500, y: 275 }, imageRect, viewport),
    ).toEqual({ x: 720, y: 450 })
  })

  it('accounts for the DOMRect offset', () => {
    expect(
      mapClientPointToRemote({ x: 100, y: 50 }, imageRect, viewport),
    ).toEqual({ x: 0, y: 0 })
  })

  it('clamps outside and far-edge coordinates to valid viewport pixels', () => {
    expect(
      mapClientPointToRemote({ x: 1000, y: 600 }, imageRect, viewport),
    ).toEqual({ x: 1439, y: 899 })
    expect(
      mapClientPointToRemote({ x: -20, y: -10 }, imageRect, viewport),
    ).toEqual({ x: 0, y: 0 })
  })

  it('can reject points outside the image', () => {
    expect(
      mapClientPointToRemote({ x: 99, y: 50 }, imageRect, viewport, {
        clamp: false,
      }),
    ).toBeNull()
  })

  it('supports explicit rounding modes', () => {
    expect(
      mapClientPointToRemote(
        { x: 100.6, y: 50.6 },
        { left: 100, top: 50, width: 10, height: 10 },
        { width: 100, height: 100 },
        { rounding: 'floor' },
      ),
    ).toEqual({ x: 5, y: 6 })
  })

  it('rejects non-finite and non-positive geometry', () => {
    expect(
      mapClientPointToRemote(
        { x: 1, y: 1 },
        { ...imageRect, width: 0 },
        viewport,
      ),
    ).toBeNull()
    expect(
      mapClientPointToRemote(
        { x: Number.NaN, y: 1 },
        imageRect,
        viewport,
      ),
    ).toBeNull()
  })
})
