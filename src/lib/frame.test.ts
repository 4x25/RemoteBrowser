import { describe, expect, it } from 'vitest'
import { base64ToBlob, computeCaptureSize } from './frame'

describe('computeCaptureSize', () => {
  it('uses CSS size multiplied by DPR', () => {
    expect(computeCaptureSize(600, 400, 2)).toEqual({
      width: 1200,
      height: 800,
    })
  })

  it('caps large captures and sanitizes invalid input', () => {
    expect(computeCaptureSize(2000, 1000, 2)).toEqual({
      width: 1440,
      height: 900,
    })
    expect(computeCaptureSize(Number.NaN, 0, Number.NaN)).toEqual({
      width: 1,
      height: 1,
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
