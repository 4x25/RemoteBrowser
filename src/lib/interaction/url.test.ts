import { describe, expect, it } from 'vitest'

import {
  InvalidBrowserUrlError,
  normalizeBrowserUrl,
  tryNormalizeBrowserUrl,
} from './url'

describe('normalizeBrowserUrl', () => {
  it('keeps absolute HTTP(S) addresses and trims whitespace', () => {
    expect(normalizeBrowserUrl(' https://example.com/path?q=1#part ')).toBe(
      'https://example.com/path?q=1#part',
    )
    expect(normalizeBrowserUrl('http://example.com')).toBe(
      'http://example.com/',
    )
  })

  it('adds https:// when the scheme is omitted', () => {
    expect(normalizeBrowserUrl('example.com/docs')).toBe(
      'https://example.com/docs',
    )
    expect(normalizeBrowserUrl('localhost:5173')).toBe(
      'https://localhost:5173/',
    )
    expect(normalizeBrowserUrl('intranet:8443/status')).toBe(
      'https://intranet:8443/status',
    )
    expect(normalizeBrowserUrl('[::1]:3000/test')).toBe(
      'https://[::1]:3000/test',
    )
  })

  it('accepts only the safe about URL', () => {
    expect(normalizeBrowserUrl('ABOUT:BLANK')).toBe('about:blank')
    expect(() => normalizeBrowserUrl('about:settings')).toThrow(
      InvalidBrowserUrlError,
    )
  })

  it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/a', 'ftp://example.com'])(
    'rejects unsupported protocol input %s',
    (input) => {
      expect(() => normalizeBrowserUrl(input)).toThrow(InvalidBrowserUrlError)
    },
  )

  it.each(['', '   ', '/relative', 'http:example.com', 'https://']) (
    'rejects invalid input %s',
    (input) => {
      expect(tryNormalizeBrowserUrl(input).ok).toBe(false)
    },
  )

  it('returns a discriminated result for UI validation', () => {
    expect(tryNormalizeBrowserUrl('example.com')).toEqual({
      ok: true,
      url: 'https://example.com/',
    })
    const result = tryNormalizeBrowserUrl('javascript:alert(1)')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('UNSUPPORTED_PROTOCOL')
    }
  })
})
