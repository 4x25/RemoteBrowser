import { describe, expect, it } from 'vitest'
import { parseMcpResponse, unwrapJsonRpcResponse } from './protocol'

describe('MCP response parsing', () => {
  it('parses an ordinary JSON-RPC response', () => {
    const values = parseMcpResponse(
      JSON.stringify({ jsonrpc: '2.0', id: 7, result: { ok: true } }),
      'application/json',
    )

    expect(unwrapJsonRpcResponse(values, 7)).toEqual({ ok: true })
  })

  it('parses a single SSE response with multiline data', () => {
    const body = [
      'event: message',
      'data: {"jsonrpc":"2.0",',
      'data: "id":3,"result":{"tools":[]}}',
      '',
    ].join('\n')

    expect(
      unwrapJsonRpcResponse(parseMcpResponse(body, 'text/event-stream'), 3),
    ).toEqual({ tools: [] })
  })

  it('normalizes JSON-RPC errors', () => {
    const values = parseMcpResponse(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        error: { code: -32602, message: 'Invalid params', data: { field: 'page' } },
      }),
    )

    expect(() => unwrapJsonRpcResponse(values, 2)).toThrowError(
      expect.objectContaining({
        kind: 'rpc',
        code: -32602,
        message: 'Invalid params',
      }),
    )
  })

  it('rejects malformed SSE data', () => {
    expect(() => parseMcpResponse('event: message\ndata: nope', 'text/event-stream'))
      .toThrowError(expect.objectContaining({ kind: 'protocol' }))
  })
})
