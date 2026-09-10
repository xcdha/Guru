import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { sanitizeGraphifyToolArgs } from './pi-mcp-tools'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { buildPiMcpTools, disposePiMcpConnections } from './pi-mcp-tools'

interface SessionServerStats {
  sessionsCreated: number
  rejectedSessions: number
  toolCalls: number
}

interface SessionServerOptions {
  expiredStatus: 400 | 404
  expireAfterFirstTool?: boolean
  expireReplacementOnInitialized?: boolean
  failToolAfterFirstWithStatus?: number
  onSessionRejected?: () => void
}

interface SessionTestServer {
  url: string
  stats: SessionServerStats
}

const cleanups: Array<() => Promise<void>> = []

function requestMethod(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('method' in body)) return undefined
  return typeof body.method === 'string' ? body.method : undefined
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  return parsed
}

function sendJsonError(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32000, message },
    id: null,
  }))
}

async function startSessionTestServer(options: SessionServerOptions): Promise<SessionTestServer> {
  const transports = new Map<string, StreamableHTTPServerTransport>()
  const servers = new Set<McpServer>()
  const stats: SessionServerStats = {
    sessionsCreated: 0,
    rejectedSessions: 0,
    toolCalls: 0,
  }

  const httpServer = createServer(async (request, response) => {
    if (request.method === 'GET') {
      response.writeHead(405).end()
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end()
      return
    }

    try {
      const body = await readJsonBody(request)
      const rawSessionId = request.headers['mcp-session-id']
      const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId
      const method = requestMethod(body)

      if (sessionId) {
        const transport = transports.get(sessionId)
        if (!transport) {
          stats.rejectedSessions += 1
          sendJsonError(response, options.expiredStatus, 'No valid session ID provided')
          options.onSessionRejected?.()
          return
        }

        if (
          options.failToolAfterFirstWithStatus &&
          stats.toolCalls > 0 &&
          method === 'tools/call'
        ) {
          sendJsonError(response, options.failToolAfterFirstWithStatus, 'Unrelated server failure')
          return
        }

        await transport.handleRequest(request, response, body)
        if (
          options.expireReplacementOnInitialized &&
          stats.sessionsCreated > 1 &&
          method === 'notifications/initialized'
        ) {
          transports.delete(sessionId)
        }
        return
      }

      if (!isInitializeRequest(body)) {
        sendJsonError(response, 400, 'Mcp-Session-Id header is required')
        return
      }

      let transport!: StreamableHTTPServerTransport
      const mcpServer = new McpServer({ name: 'pi-mcp-session-test', version: '1.0.0' })
      mcpServer.registerTool('ping', { description: '返回 pong' }, async () => {
        stats.toolCalls += 1
        if ((options.expireAfterFirstTool ?? true) && stats.toolCalls === 1 && transport.sessionId) {
          transports.delete(transport.sessionId)
        }
        return { content: [{ type: 'text' as const, text: 'pong' }] }
      })

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (newSessionId) => {
          stats.sessionsCreated += 1
          transports.set(newSessionId, transport)
        },
      })
      servers.add(mcpServer)
      await mcpServer.connect(transport)
      await transport.handleRequest(request, response, body)
    } catch (error) {
      if (!response.headersSent) {
        sendJsonError(response, 500, error instanceof Error ? error.message : String(error))
      }
    }
  })

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const address = httpServer.address()
  if (!address || typeof address === 'string') throw new Error('无法获取测试服务器端口')

  const close = async (): Promise<void> => {
    await Promise.allSettled([...servers].map((server) => server.close()))
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => error ? reject(error) : resolve())
    })
  }
  cleanups.push(close)

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    stats,
  }
}

type FlakyMcpServerMode = 'fail' | 'healthy' | 'hang'

interface FlakyMcpServer {
  url: string
  setMode: (mode: FlakyMcpServerMode) => void
  disconnectClients: () => void
}

/**
 * required 冷却测试用可切换 MCP 服务器：
 * - fail：所有请求立即返回 503（快速握手失败）
 * - healthy：正常 MCP serve（initialize/listTools 全流程）
 * - hang：接受请求但永不响应（模拟挂死服务器，用于验证冷却内的 500ms 竞态上限）
 */
async function startFlakyTestServer(): Promise<FlakyMcpServer> {
  let mode: FlakyMcpServerMode = 'fail'
  const sockets = new Set<Socket>()
  const transports = new Map<string, StreamableHTTPServerTransport>()
  const servers = new Set<McpServer>()

  const httpServer = createServer(async (request, response) => {
    if (mode === 'hang') return
    if (mode === 'fail') {
      sendJsonError(response, 503, 'MCP server temporarily unavailable')
      return
    }

    if (request.method === 'GET') {
      response.writeHead(405).end()
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end()
      return
    }

    try {
      const body = await readJsonBody(request)
      const rawSessionId = request.headers['mcp-session-id']
      const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId

      if (sessionId) {
        const transport = transports.get(sessionId)
        if (!transport) {
          sendJsonError(response, 404, 'No valid session ID provided')
          return
        }
        await transport.handleRequest(request, response, body)
        return
      }

      if (!isInitializeRequest(body)) {
        sendJsonError(response, 400, 'Mcp-Session-Id header is required')
        return
      }

      let transport!: StreamableHTTPServerTransport
      const mcpServer = new McpServer({ name: 'pi-mcp-flaky-test', version: '1.0.0' })
      mcpServer.registerTool('ping', { description: '返回 pong' }, async () => (
        { content: [{ type: 'text' as const, text: 'pong' }] }
      ))

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (newSessionId) => {
          transports.set(newSessionId, transport)
        },
      })
      servers.add(mcpServer)
      await mcpServer.connect(transport)
      await transport.handleRequest(request, response, body)
    } catch (error) {
      if (!response.headersSent) {
        sendJsonError(response, 500, error instanceof Error ? error.message : String(error))
      }
    }
  })

  httpServer.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => {
      sockets.delete(socket)
    })
  })

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const address = httpServer.address()
  if (!address || typeof address === 'string') throw new Error('无法获取测试服务器端口')

  const disconnectClients = (): void => {
    for (const socket of [...sockets]) socket.destroy()
    sockets.clear()
  }

  const close = async (): Promise<void> => {
    disconnectClients()
    await Promise.allSettled([...servers].map((server) => server.close()))
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => error ? reject(error) : resolve())
    })
  }
  cleanups.push(close)

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    setMode: (nextMode) => {
      mode = nextMode
    },
    disconnectClients,
  }
}

async function buildPingTool(serverName: string, url: string): Promise<ToolDefinition> {
  const tools = await buildPiMcpTools({
    [serverName]: { type: 'http', url, required: true },
  })
  const ping = tools.find((tool) => tool.name === `mcp__${serverName}__ping`)
  if (!ping) throw new Error(`未找到 ${serverName} 的 ping 工具`)
  return ping
}

// MCP 桥接工具不会读取 ExtensionContext；测试只验证其公开 execute 行为。
const unusedExtensionContext = undefined as unknown as Parameters<ToolDefinition['execute']>[4]

async function callPing(
  tool: ToolDefinition,
  callId: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<void> {
  await tool.execute(callId, {}, signal, undefined, unusedExtensionContext)
}

afterEach(async () => {
  await disposePiMcpConnections()
  const pendingCleanups = cleanups.splice(0)
  await Promise.allSettled(pendingCleanups.map((cleanup) => cleanup()))
})

describe('Pi MCP Streamable HTTP Session 恢复', () => {
  test.each([400, 404] as const)('已建立的 Session 收到 HTTP %i 后重新握手并重试一次', async (expiredStatus) => {
    const server = await startSessionTestServer({ expiredStatus })
    const ping = await buildPingTool(`session_${expiredStatus}`, server.url)

    await callPing(ping, 'first-call')
    await callPing(ping, 'recovered-call')

    expect(server.stats).toEqual({
      sessionsCreated: 2,
      rejectedSessions: 1,
      toolCalls: 2,
    })
  })

  test('并发调用发现同一 Session 失效时只建立一个替代连接', async () => {
    const server = await startSessionTestServer({ expiredStatus: 404 })
    const ping = await buildPingTool('concurrent_recovery', server.url)

    await callPing(ping, 'first-call')
    await Promise.all([
      callPing(ping, 'concurrent-call-a'),
      callPing(ping, 'concurrent-call-b'),
    ])

    expect(server.stats).toEqual({
      sessionsCreated: 2,
      rejectedSessions: 2,
      toolCalls: 3,
    })
  })

  test('替代 Session 仍失效时不进行第三次重试', async () => {
    const server = await startSessionTestServer({
      expiredStatus: 400,
      expireReplacementOnInitialized: true,
    })
    const ping = await buildPingTool('single_retry', server.url)

    await callPing(ping, 'first-call')
    await expect(callPing(ping, 'failed-recovery')).rejects.toThrow('No valid session ID provided')

    expect(server.stats).toEqual({
      sessionsCreated: 2,
      rejectedSessions: 2,
      toolCalls: 1,
    })
  })

  test('Session 失效与调用取消同时发生时淘汰旧连接但不重试', async () => {
    let reportAborted = false
    const server = await startSessionTestServer({
      expiredStatus: 404,
      onSessionRejected: () => {
        reportAborted = true
      },
    })
    const ping = await buildPingTool('cancelled_recovery', server.url)
    const controller = new AbortController()
    // 模拟 HTTP 拒绝已经发生，而恢复 catch 执行时调用恰好被取消。
    Object.defineProperty(controller.signal, 'aborted', {
      configurable: true,
      get: () => reportAborted,
    })

    await callPing(ping, 'first-call')
    await expect(callPing(ping, 'cancelled-call', controller.signal)).rejects.toThrow('No valid session ID provided')
    expect(server.stats).toEqual({
      sessionsCreated: 1,
      rejectedSessions: 1,
      toolCalls: 1,
    })

    await callPing(ping, 'next-call')
    expect(server.stats).toEqual({
      sessionsCreated: 2,
      rejectedSessions: 1,
      toolCalls: 2,
    })
  })

  test.each([400, 500])('非 Session HTTP %i 错误不重建连接或重试工具', async (status) => {
    const server = await startSessionTestServer({
      expiredStatus: 404,
      expireAfterFirstTool: false,
      failToolAfterFirstWithStatus: status,
    })
    const ping = await buildPingTool(`non_session_error_${status}`, server.url)

    await callPing(ping, 'first-call')
    await expect(callPing(ping, 'server-error')).rejects.toThrow('Unrelated server failure')

    expect(server.stats).toEqual({
      sessionsCreated: 1,
      rejectedSessions: 0,
      toolCalls: 1,
    })
  })
})


describe('Graphify 工具参数安全（2026-08-14 P3）', () => {
  test('sanitizeGraphifyToolArgs 剥掉 project_path（跨目录选图防护）', () => {
    expect(sanitizeGraphifyToolArgs({ project_path: 'C:\evil\dir', question: 'x' })).toEqual({ question: 'x' })
    expect(sanitizeGraphifyToolArgs({ project_path: '', question: 'x' })).toEqual({ question: 'x' })
  })

  test('无 project_path 时原样返回且不新增字段', () => {
    const args = { question: 'x', depth: 2 }
    expect(sanitizeGraphifyToolArgs(args)).toEqual({ question: 'x', depth: 2 })
  })
})

describe('Pi MCP required 失败冷却（对齐上游 #1976）', () => {
  test('required 首次握手失败后进入冷却：后续回合只等 bootstrap 窗口，不阻塞完整握手超时', async () => {
    const server = await startFlakyTestServer()
    const serverName = 'required_cooldown_hang'
    const config = { type: 'http', url: server.url, required: true, startup_timeout_sec: 10 }

    // 第一次：fail 模式，握手快速失败 → 记入冷却并跳过该服务器（不抛错、不阻断会话）
    const first = await buildPiMcpTools({ [serverName]: config })
    expect(first).toEqual([])

    // 第二次：服务器转为挂死。冷却期内回落到 500ms bootstrap 竞态；
    // 若冷却未生效，这里会等待完整的 10s connect 超时。
    server.setMode('hang')
    try {
      const startedAt = Date.now()
      const second = await buildPiMcpTools({ [serverName]: config })
      const elapsedMs = Date.now() - startedAt
      expect(second).toEqual([])
      expect(elapsedMs).toBeLessThan(3000)
    } finally {
      server.disconnectClients()
    }
  })

  test('冷却期内同端口服务恢复：本回合即返回工具并退出冷却', async () => {
    const server = await startFlakyTestServer()
    const serverName = 'required_cooldown_recovery'
    const config = { type: 'http', url: server.url, required: true, startup_timeout_sec: 10 }

    const first = await buildPiMcpTools({ [serverName]: config })
    expect(first).toEqual([])

    // 服务恢复后（仍在 2 分钟冷却期内），后台重连一旦成功应立即退出冷却：
    // 本回合即桥接到工具，而不是等冷却过期。
    server.setMode('healthy')
    const second = await buildPiMcpTools({ [serverName]: config })
    const ping = second.find((tool) => tool.name === `mcp__${serverName}__ping`)
    if (!ping) throw new Error(`未找到 ${serverName} 的 ping 工具`)
    await callPing(ping, 'recovered-call')
  })
})
