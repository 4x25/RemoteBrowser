import { McpCallError } from './errors'

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

interface JsonRpcErrorShape {
  code: number
  message: string
  data?: unknown
}

interface JsonRpcResponseShape {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: JsonRpcErrorShape
}

export interface McpTextContent {
  type: 'text'
  text: string
}

export interface McpImageContent {
  type: 'image'
  data: string
  mimeType: string
}

export type McpContent = McpTextContent | McpImageContent | Record<string, unknown>

export interface McpToolResult<TStructured = unknown> {
  content?: McpContent[]
  structuredContent?: TStructured
  isError?: boolean
  [key: string]: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch (cause) {
    throw new McpCallError('BrowserOS returned malformed JSON', {
      kind: 'protocol',
      data: value.slice(0, 500),
      cause,
    })
  }
}

/** Decode the data envelope used by newer BrowserOS run results, never code. */
export function parseRunValue(value: unknown): unknown {
  if (typeof value !== 'string') return value

  const normalized = value.replace(/\r\n/g, '\n')
  const opening = /^\[UNTRUSTED_PAGE_CONTENT nonce=([a-zA-Z0-9_-]+) origin=run\][^\n]*\n/.exec(normalized)
  const closing = opening
    ? `\n[END_UNTRUSTED_PAGE_CONTENT nonce=${opening[1]}]`
    : ''
  if (!opening || !normalized.endsWith(closing)) {
    throw new McpCallError('BrowserOS returned an invalid run data envelope', {
      kind: 'protocol',
    })
  }

  // Parse only the complete payload; marker-like text inside JSON stays data.
  return parseJson(normalized.slice(opening[0].length, -closing.length))
}

/** Parse either a regular JSON response or one or more complete SSE events. */
export function parseMcpResponse(body: string, contentType = ''): unknown[] {
  const trimmed = body.trim()
  if (!trimmed) return []

  const looksLikeSse =
    contentType.toLowerCase().includes('text/event-stream') ||
    /^(?:event|data|id|retry):/m.test(trimmed)

  if (!looksLikeSse) return [parseJson(trimmed)]

  const values: unknown[] = []
  const normalized = trimmed.replace(/\r\n?/g, '\n')
  const events = normalized.split(/\n\n+/)

  for (const event of events) {
    const dataLines: string[] = []
    for (const line of event.split('\n')) {
      if (line.startsWith(':')) continue
      if (line === 'data') {
        dataLines.push('')
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''))
      }
    }
    if (dataLines.length === 0) continue
    const data = dataLines.join('\n').trim()
    if (!data || data === '[DONE]') continue
    values.push(parseJson(data))
  }

  if (values.length === 0) {
    throw new McpCallError('BrowserOS returned an SSE response without JSON data', {
      kind: 'protocol',
      data: trimmed.slice(0, 500),
    })
  }

  return values
}

export function unwrapJsonRpcResponse(
  values: unknown[],
  expectedId: number,
): unknown {
  let response: JsonRpcResponseShape | undefined

  for (const value of values) {
    if (!isRecord(value) || value.jsonrpc !== '2.0') continue
    if (value.id === expectedId) {
      response = value as unknown as JsonRpcResponseShape
      break
    }
  }

  if (!response) {
    throw new McpCallError(`BrowserOS response did not contain JSON-RPC id ${expectedId}`, {
      kind: 'protocol',
      data: values,
    })
  }

  if (response.error) {
    throw new McpCallError(response.error.message || 'BrowserOS JSON-RPC call failed', {
      kind: 'rpc',
      code: response.error.code,
      data: response.error.data,
    })
  }

  if (!Object.prototype.hasOwnProperty.call(response, 'result')) {
    throw new McpCallError('BrowserOS JSON-RPC response is missing a result', {
      kind: 'protocol',
      data: response,
    })
  }

  return response.result
}

export function toolResultText(result: McpToolResult): string {
  if (!Array.isArray(result.content)) return ''
  return result.content
    .filter((item): item is McpTextContent =>
      isRecord(item) && item.type === 'text' && typeof item.text === 'string',
    )
    .map((item) => item.text)
    .join('\n')
    .trim()
}

export function assertToolResult(value: unknown, toolName: string): McpToolResult {
  if (!isRecord(value)) {
    throw new McpCallError(`BrowserOS tool "${toolName}" returned an invalid result`, {
      kind: 'protocol',
      data: value,
    })
  }

  const result = value as McpToolResult
  if (result.isError) {
    throw new McpCallError(
      toolResultText(result) || `BrowserOS tool "${toolName}" failed`,
      { kind: 'tool', code: toolName, data: result },
    )
  }
  return result
}

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
}
