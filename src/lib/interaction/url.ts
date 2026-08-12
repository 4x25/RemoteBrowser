export type BrowserUrlErrorCode =
  | 'EMPTY'
  | 'INVALID_URL'
  | 'UNSUPPORTED_PROTOCOL'

export class InvalidBrowserUrlError extends Error {
  readonly code: BrowserUrlErrorCode

  constructor(code: BrowserUrlErrorCode, message: string) {
    super(message)
    this.name = 'InvalidBrowserUrlError'
    this.code = code
  }
}

export type BrowserUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: InvalidBrowserUrlError }

const absoluteHttpPattern = /^https?:\/\//i
const schemePattern = /^([a-z][a-z\d+.-]*):/i
const bareHostWithPortPattern = /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)(?:\.(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?))*:\d+(?:[/?#]|$)/i
const bareIpv6WithPortPattern = /^\[[a-f\d:.]+\]:\d+(?:[/?#]|$)/i

/** Normalize address-bar input to an absolute HTTP(S) URL or about:blank. */
export function normalizeBrowserUrl(input: string): string {
  const value = input.trim()
  if (!value) {
    throw new InvalidBrowserUrlError('EMPTY', '请输入网址')
  }

  if (/^about:blank$/i.test(value)) {
    return 'about:blank'
  }
  if (/^about:/i.test(value)) {
    throw new InvalidBrowserUrlError(
      'UNSUPPORTED_PROTOCOL',
      '仅支持 about:blank、HTTP 和 HTTPS 地址',
    )
  }

  if (/^https?:/i.test(value) && !absoluteHttpPattern.test(value)) {
    throw new InvalidBrowserUrlError('INVALID_URL', 'HTTP(S) 地址必须包含 //')
  }

  let candidate = value
  if (!absoluteHttpPattern.test(candidate)) {
    const scheme = candidate.match(schemePattern)?.[1]
    const isBareHostWithPort =
      bareHostWithPortPattern.test(candidate) ||
      bareIpv6WithPortPattern.test(candidate)

    if (scheme && !isBareHostWithPort) {
      throw new InvalidBrowserUrlError(
        'UNSUPPORTED_PROTOCOL',
        `不支持 ${scheme.toLowerCase()}: 协议`,
      )
    }
    if (/^[./?#]/.test(candidate)) {
      throw new InvalidBrowserUrlError('INVALID_URL', '请输入完整的主机名或网址')
    }
    candidate = `https://${candidate}`
  }

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new InvalidBrowserUrlError('INVALID_URL', '网址格式无效')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidBrowserUrlError(
      'UNSUPPORTED_PROTOCOL',
      '仅支持 HTTP 和 HTTPS 地址',
    )
  }
  if (!parsed.hostname) {
    throw new InvalidBrowserUrlError('INVALID_URL', '网址缺少主机名')
  }

  return parsed.href
}

export function tryNormalizeBrowserUrl(input: string): BrowserUrlResult {
  try {
    return { ok: true, url: normalizeBrowserUrl(input) }
  } catch (error) {
    if (error instanceof InvalidBrowserUrlError) {
      return { ok: false, error }
    }
    throw error
  }
}
