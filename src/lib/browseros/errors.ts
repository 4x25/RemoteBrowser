export type McpErrorKind =
  | 'validation'
  | 'connection'
  | 'aborted'
  | 'timeout'
  | 'transport'
  | 'http'
  | 'protocol'
  | 'rpc'
  | 'tool'

export interface McpCallErrorOptions {
  kind: McpErrorKind
  code?: number | string
  status?: number
  data?: unknown
  cause?: unknown
}

/** A normalized error raised by every BrowserOS client operation. */
export class McpCallError extends Error {
  readonly kind: McpErrorKind
  readonly code?: number | string
  readonly status?: number
  readonly data?: unknown
  override readonly cause?: unknown

  constructor(message: string, options: McpCallErrorOptions) {
    super(message)
    this.name = 'McpCallError'
    this.kind = options.kind
    this.code = options.code
    this.status = options.status
    this.data = options.data
    this.cause = options.cause
  }
}

export function validationError(message: string): McpCallError {
  return new McpCallError(message, { kind: 'validation' })
}
