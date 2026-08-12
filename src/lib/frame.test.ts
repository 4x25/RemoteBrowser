import { describe, expect, it } from 'vitest'
import { base64ToBlob, computeCaptureSize } from './frame'

describe('computeCaptureSize', () => {
  it('uses CSS size multiplied by DPR', () => {
    expect(computeCaptureSize(600, 400, 2)).toEqual({
      width: 1200,
      height: 800,
      viewportWidth: 600,
      viewportHeight: 400,
      deviceScaleFactor: 2,
    })
  })

  it('uses one effective scale factor when either pixel limit is reached', () => {
    expect(computeCaptureSize(2000, 1000, 2)).toEqual({
      width: 1440,
      height: 720,
      viewportWidth: 2000,
      viewportHeight: 1000,
      deviceScaleFactor: 0.72,
    })

    expect(computeCaptureSize(600, 800, 2)).toEqual({
      width: 675,
      height: 900,
      viewportWidth: 600,
      viewportHeight: 800,
      deviceScaleFactor: 1.125,
    })
  })

  it('rounds CSS dimensions and sanitizes invalid input', () => {
    expect(computeCaptureSize(500.4, 300.6, 1)).toEqual({
      width: 500,
      height: 301,
      viewportWidth: 500,
      viewportHeight: 301,
      deviceScaleFactor: 1,
    })
    expect(computeCaptureSize(Number.NaN, 0, Number.NaN)).toEqual({
      width: 1,
      height: 1,
      viewportWidth: 1,
      viewportHeight: 1,
      deviceScaleFactor: 1,
    })
  })
})

describe('base64ToBlob', () => {
  it('decodes a screenshot payload', async () => {
    const blob = base64ToBlob({
      data: btoa('image-bytes'),
      mimeType: 'image/webp',
    })

    expect(blob.type).toBe('image/webp')
    expect(await blob.text()).toBe('image-bytes')
  })
})
