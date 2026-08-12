import { describe, expect, it, vi } from 'vitest'
import { FrameCache } from './frameCache'

interface TestFrame {
  pageId: number
  objectUrl: string
}

describe('FrameCache', () => {
  it('keeps one frame per page and only revokes a frame when replaced', () => {
    const revoke = vi.fn()
    const cache = new FrameCache<TestFrame>(revoke)
    const first = { pageId: 1, objectUrl: 'blob:first' }
    const second = { pageId: 2, objectUrl: 'blob:second' }

    cache.replace(first)
    cache.replace(second)

    expect(cache.get(1)).toBe(first)
    expect(cache.get(2)).toBe(second)
    expect(revoke).not.toHaveBeenCalled()

    const replacement = { pageId: 1, objectUrl: 'blob:replacement' }
    cache.replace(replacement)
    expect(cache.get(1)).toBe(replacement)
    expect(revoke).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:first')
  })

  it('prunes closed pages and clears every remaining URL once', () => {
    const revoke = vi.fn()
    const cache = new FrameCache<TestFrame>(revoke)
    cache.replace({ pageId: 1, objectUrl: 'blob:shared' })
    cache.replace({ pageId: 2, objectUrl: 'blob:second' })
    cache.replace({ pageId: 3, objectUrl: 'blob:shared' })

    cache.retain([1, 3])
    expect(cache.get(2)).toBeNull()
    expect(revoke).toHaveBeenCalledWith('blob:second')

    cache.clear()
    expect(revoke.mock.calls).toEqual([
      ['blob:second'],
      ['blob:shared'],
    ])
  })

  it('does not revoke a shared URL while another cached page still uses it', () => {
    const revoke = vi.fn()
    const cache = new FrameCache<TestFrame>(revoke)
    cache.replace({ pageId: 1, objectUrl: 'blob:shared' })
    cache.replace({ pageId: 2, objectUrl: 'blob:shared' })

    cache.delete(1)
    expect(revoke).not.toHaveBeenCalled()

    cache.delete(2)
    expect(revoke).toHaveBeenCalledOnce()
    expect(revoke).toHaveBeenCalledWith('blob:shared')
  })
})
