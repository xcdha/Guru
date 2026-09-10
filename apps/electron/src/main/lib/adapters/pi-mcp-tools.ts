/**
 * Pi Runtime 用户 MCP 工具桥接层
 *
 * Claude runtime 继续使用 Claude Agent SDK 原生 mcpServers；Pi SDK 当前没有等价
 * mcpServers 参数，因此 Guru 在主进程连接用户配置的 MCP server，并把 MCP tools
 * 映射成 Pi customTools。
 */

import { createHash } from 'node:crypto'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { TextContent, ImageContent } from '@earendil-works/pi-ai'
import type { TSchema } from 'typebox'
import { Type } from 'typebox'
import { sanitizeToolResultImageContent } from '../image-content-validation'
import { getEffectiveProxyUrl } from '../proxy-settings-service'
import { getFetchFn } from '../proxy-fetch'

const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 60_000
const DEFAULT_MCP_STARTUP_TIMEOUT_MS = 30_000
const OPTIONAL_MCP_BOOTSTRAP_TIMEOUT_MS = 500
/**
 * required MCP 连接失败后的冷却窗口。冷却期内按可选服务器处理（本回合最多等
 * bootstrap 窗口，后台继续重连），避免失效服务器让每轮 Agent 请求都阻塞完整的
 * 握手超时（默认 30s connect + 60s listTools）。
 */
const REQUIRED_MCP_FAILURE_COOLDOWN_MS = 2 * 60_000
/** 失败冷却表的防御性上限；超出时淘汰最旧记录，避免配置频繁变更导致无限增长。 */
const REQUIRED_MCP_FAILURE_CACHE_LIMIT = 64
const HTTP_SESSION_REJECTION_PATTERN = /missing session id|no valid session id provided|mcp-session-id header is required/i

/** required MCP 最近一次工具发现失败的时间（key: serverName + 配置摘要）。 */
const requiredMcpFailureTimestamps = new Map<string, number>()

function markRequiredMcpFailure(key: string): void {
  if (requiredMcpFailureTimestamps.size >= REQUIRED_MCP_FAILURE_CACHE_LIMIT) {
    const oldestKey = requiredMcpFailureTimestamps.keys().next().value
    if (oldestKey !== undefined) requiredMcpFailureTimestamps.delete(oldestKey)
  }
  requiredMcpFailureTimestamps.set(key, Date.now())
}

interface PiMcpServerConfig {
  type?: unknown
  command?: unknown
  args?: unknown
  env?: unknown
  url?: unknown
  headers?: unknown
  startup_timeout_sec?: unknown
  timeout?: unknown
  required?: unknown
}

type PiMcpServers = Record<string, Record<string, unknown>>

type McpToolInfo = Awaited<ReturnType<Client['listTools']>>['tools'][number]

type McpCallToolResult = Awaited<ReturnType<Client['callTool']>>

interface McpConnection {
  client: Client
  transport: Transport
  close: () => Promise<void>
  tools?: McpToolInfo[]
  toolsPromise?: Promise<McpToolInfo[]>
}

interface McpConnectionEntry {
  promise: Promise<McpConnection>
  activeLeases: number
  stale: boolean
  closed: boolean
}

interface McpConnectionLease {
  key: string
  entry: McpConnectionEntry
  connection: McpConnection
}

interface McpToolBinding {
  serverName: string
  originalToolName: string
  tool: McpToolInfo
  manager: PiMcpClientManager
  managerConfig: PiMcpServerConfig
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`
}

function configHash(config: unknown): string {
  return createHash('sha256').update(stableStringify(config)).digest('hex').slice(0, 16)
}

function normalizeToolSegment(segment: string): string {
  const normalized = segment.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
  if (!normalized) return 'unnamed'
  return /^[A-Za-z_]/.test(normalized) ? normalized : `_${normalized}`
}

function mcpToolName(serverName: string, toolName: string): string {
  return `mcp__${normalizeToolSegment(serverName)}__${normalizeToolSegment(toolName)}`
}

function getHeaders(config: PiMcpServerConfig): Record<string, string> | undefined {
  if (!config.headers || typeof config.headers !== 'object') return undefined
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(config.headers as Record<string, unknown>)) {
    if (typeof value === 'string') headers[key] = value
  }
  return Object.keys(headers).length > 0 ? headers : undefined
}

function getTimeoutMs(config: PiMcpServerConfig): number {
  const timeoutSec = typeof config.startup_timeout_sec === 'number'
    ? config.startup_timeout_sec
    : typeof config.timeout === 'number'
      ? config.timeout
      : undefined
  if (!timeoutSec || !Number.isFinite(timeoutSec) || timeoutSec <= 0) return DEFAULT_MCP_STARTUP_TIMEOUT_MS
  return timeoutSec * 1000
}

function createTransport(name: string, config: PiMcpServerConfig, fetchFn?: typeof globalThis.fetch): Transport | undefined {
  const type = config.type
  if (type === 'stdio') {
    if (typeof config.command !== 'string' || !config.command.trim()) {
      console.warn(`[Pi MCP] MCP 服务器 ${name} 缺少 command，已跳过`)
      return undefined
    }
    const env = typeof config.env === 'object' && config.env
      ? Object.fromEntries(Object.entries(config.env as Record<string, unknown>).filter(([, value]) => typeof value === 'string')) as Record<string, string>
      : undefined
    return new StdioClientTransport({
      command: config.command,
      args: Array.isArray(config.args) ? config.args.filter((arg): arg is string => typeof arg === 'string') : undefined,
      env,
      stderr: 'inherit',
    })
  }

  if (type === 'http') {
    if (typeof config.url !== 'string' || !config.url.trim()) {
      console.warn(`[Pi MCP] MCP 服务器 ${name} 缺少 url，已跳过`)
      return undefined
    }
    const headers = getHeaders(config)
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: headers ? { headers } : undefined,
      // 代理感知 fetch：让需要代理才能访问的远程 MCP（如 Tavily）在 GFW 等网络下可用
      ...(fetchFn ? { fetch: fetchFn } : {}),
    })
  }

  if (type === 'sse') {
    if (typeof config.url !== 'string' || !config.url.trim()) {
      console.warn(`[Pi MCP] MCP 服务器 ${name} 缺少 url，已跳过`)
      return undefined
    }
    const headers = getHeaders(config)
    // SSE 分支同样支持代理感知 fetch（构造时由 createConnection 解析代理后传入）。
    // EventSource 长连接流必须与 POST 握手走同一 fetch：SDK 里
    // fetchImpl = eventSourceInit?.fetch ?? _fetch ?? fetch，若不在此处用 fetchFn，
    // SSE 事件流会退回到裸全局 fetch（不读代理）导致 GFW 下连不上。
    const baseFetch = fetchFn ?? fetch
    return new SSEClientTransport(new URL(config.url), {
      requestInit: headers ? { headers } : undefined,
      ...(fetchFn ? { fetch: fetchFn } : {}),
      eventSourceInit: headers
        ? ({
          fetch: (input: RequestInfo | URL, init?: RequestInit) => baseFetch(input, {
            ...init,
            headers: {
              ...(init?.headers as Record<string, string> | undefined),
              ...headers,
            },
          }),
        } as any)
        : undefined,
    })
  }

  console.warn(`[Pi MCP] MCP 服务器 ${name} 使用暂不支持的类型 ${String(type)}，已跳过`)
  return undefined
}

function isObjectSchema(schema: unknown): schema is Record<string, unknown> {
  return !!schema && typeof schema === 'object' && !Array.isArray(schema)
}

function toTypeBoxSchema(schema: unknown): TSchema {
  if (!isObjectSchema(schema)) return Type.Object({})
  if (schema.type !== 'object') return Type.Object({})
  return Type.Unsafe(schema)
}

function stringifyForTool(content: unknown): string {
  if (typeof content === 'string') return content
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

function convertMcpResult(result: McpCallToolResult): AgentToolResult<unknown> {
  const content: Array<TextContent | ImageContent> = []

  if ('content' in result && Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text })
      } else if (block.type === 'image') {
        content.push({ type: 'image', data: block.data, mimeType: block.mimeType })
      } else {
        content.push({ type: 'text', text: stringifyForTool(block) })
      }
    }
  } else if ('toolResult' in result) {
    content.push({ type: 'text', text: stringifyForTool(result.toolResult) })
  }

  if ('structuredContent' in result && result.structuredContent !== undefined) {
    content.push({ type: 'text', text: `structuredContent:\n${stringifyForTool(result.structuredContent)}` })
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: stringifyForTool(result) })
  }

  if ('isError' in result && result.isError) {
    content.unshift({ type: 'text', text: 'MCP tool returned isError=true.' })
  }

  return {
    content: sanitizeToolResultImageContent(content),
    details: result,
  } as AgentToolResult<unknown>
}

/**
 * Optional MCP 服务首次连接在后台继续；首轮消息最多为它等待短暂的 bootstrap 窗口。
 * 连接完成后，manager 会缓存 tools，后续回合直接复用，不会重复冷启动 stdio 进程。
 */
async function listOptionalMcpTools(
  manager: PiMcpClientManager,
  serverName: string,
  config: PiMcpServerConfig,
): Promise<McpToolInfo[] | undefined> {
  const toolsPromise = manager.listTools(serverName, config)
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      toolsPromise,
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), OPTIONAL_MCP_BOOTSTRAP_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

/**
 * Required MCP 需要等待真实握手结果，保证刚连接/刚变更配置的服务器在本回合即可用。
 * 但一旦最近一次工具发现失败过，冷却期内回落到 optional 竞态（后台继续重连），
 * 避免断网、失效凭据或异常服务器反复阻塞后续每一轮消息。冷却期内的后台重连一旦
 * 成功，立即退出冷却并恢复 required 语义。
 *
 * 注：失败仍向上抛错，由 buildPiMcpTools 的 allSettled 接住并跳过该服务器，
 * 不会阻断会话启动；冷却只影响等待时长。
 */
async function listRequiredMcpTools(
  manager: PiMcpClientManager,
  serverName: string,
  config: PiMcpServerConfig,
): Promise<McpToolInfo[] | undefined> {
  const failureKey = `${serverName}:${configHash(config)}`
  const failedAt = requiredMcpFailureTimestamps.get(failureKey)
  if (failedAt !== undefined && Date.now() - failedAt < REQUIRED_MCP_FAILURE_COOLDOWN_MS) {
    const tools = await listOptionalMcpTools(manager, serverName, config)
    if (tools) requiredMcpFailureTimestamps.delete(failureKey)
    return tools
  }
  try {
    const tools = await manager.listTools(serverName, config)
    requiredMcpFailureTimestamps.delete(failureKey)
    return tools
  } catch (error) {
    markRequiredMcpFailure(failureKey)
    console.warn(
      `[Pi MCP] required MCP 服务器 ${serverName} 连接失败，${REQUIRED_MCP_FAILURE_COOLDOWN_MS / 1000}s 冷却期内将按可选服务器处理`,
      error,
    )
    throw error
  }
}

class PiMcpClientManager {
  private readonly connections = new Map<string, McpConnectionEntry>()
  private lifecycleGeneration = 0

  /**
   * 关闭所有活跃的 MCP 连接，释放 stdio 子进程和网络资源。
   * 应在 app quit 或 agent session 结束时调用。
   */
  async dispose(): Promise<void> {
    this.lifecycleGeneration += 1
    const entries = [...this.connections.values()]
    this.connections.clear()
    requiredMcpFailureTimestamps.clear()
    await Promise.allSettled(
      entries.map(async (entry) => {
        try {
          const conn = await entry.promise
          await conn.close()
        } catch {
          // 连接本身就失败了，忽略
        }
      }),
    )
  }

  async listTools(serverName: string, config: PiMcpServerConfig): Promise<McpToolInfo[]> {
    return this.executeWithSessionRecovery(serverName, config, undefined, async (connection) => {
      if (connection.tools) return connection.tools
      if (!connection.toolsPromise) {
        connection.toolsPromise = connection.client.listTools(undefined, { timeout: DEFAULT_MCP_REQUEST_TIMEOUT_MS })
          .then((result) => {
            connection.tools = result.tools
            return result.tools
          })
          .catch((error) => {
            connection.toolsPromise = undefined
            throw error
          })
      }
      return connection.toolsPromise
    })
  }

  async callTool(serverName: string, config: PiMcpServerConfig, toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallToolResult> {
    return this.executeWithSessionRecovery(serverName, config, signal, (connection) =>
      connection.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { signal, timeout: DEFAULT_MCP_REQUEST_TIMEOUT_MS, resetTimeoutOnProgress: true },
      ))
  }

  private async executeWithSessionRecovery<T>(
    serverName: string,
    config: PiMcpServerConfig,
    signal: AbortSignal | undefined,
    operation: (connection: McpConnection) => Promise<T>,
  ): Promise<T> {
    const lifecycleGeneration = this.lifecycleGeneration
    const lease = await this.acquireConnection(serverName, config)
    let leaseReleased = false
    try {
      try {
        return await operation(lease.connection)
      } catch (error) {
        if (!this.isRejectedHttpSession(error, lease.connection)) {
          throw error
        }

        this.markConnectionStale(lease)
        await this.releaseConnection(lease)
        leaseReleased = true
        if (signal?.aborted || this.lifecycleGeneration !== lifecycleGeneration) throw error

        console.info(`[Pi MCP] MCP 服务器 ${serverName} Session 已失效，正在重新握手`)

        const replacement = await this.acquireConnection(serverName, config)
        try {
          try {
            return await operation(replacement.connection)
          } catch (retryError) {
            if (this.isRejectedHttpSession(retryError, replacement.connection)) {
              this.markConnectionStale(replacement)
            }
            throw retryError
          }
        } finally {
          await this.releaseConnection(replacement)
        }
      }
    } finally {
      if (!leaseReleased) {
        await this.releaseConnection(lease)
      }
    }
  }

  private isRejectedHttpSession(error: unknown, connection: McpConnection): boolean {
    if (!(connection.transport instanceof StreamableHTTPClientTransport)) return false
    if (connection.transport.sessionId === undefined) return false
    if (!(error instanceof StreamableHTTPError)) return false
    if (error.code === 404) return true
    return error.code === 400 && HTTP_SESSION_REJECTION_PATTERN.test(error.message)
  }

  private async acquireConnection(serverName: string, config: PiMcpServerConfig): Promise<McpConnectionLease> {
    const key = `${serverName}:${configHash(config)}`
    let entry = this.connections.get(key)

    if (!entry) {
      let createdEntry!: McpConnectionEntry
      const promise = this.createConnection(serverName, config, () => {
        createdEntry.stale = true
        createdEntry.closed = true
        if (this.connections.get(key) === createdEntry) {
          this.connections.delete(key)
        }
      }).catch((error) => {
        createdEntry.stale = true
        if (this.connections.get(key) === createdEntry) {
          this.connections.delete(key)
        }
        throw error
      })
      createdEntry = {
        promise,
        activeLeases: 0,
        stale: false,
        closed: false,
      }
      entry = createdEntry
      this.connections.set(key, entry)
    }

    entry.activeLeases += 1
    try {
      return {
        key,
        entry,
        connection: await entry.promise,
      }
    } catch (error) {
      entry.activeLeases -= 1
      throw error
    }
  }

  private markConnectionStale(lease: McpConnectionLease): void {
    lease.entry.stale = true
    if (this.connections.get(lease.key) === lease.entry) {
      this.connections.delete(lease.key)
    }
  }

  private async releaseConnection(lease: McpConnectionLease): Promise<void> {
    lease.entry.activeLeases -= 1
    if (!lease.entry.stale || lease.entry.closed || lease.entry.activeLeases > 0) return
    try {
      await lease.connection.close()
    } catch {
      // Session 已由服务端终止，关闭旧 transport 失败不影响重新握手。
    }
  }

  private async createConnection(
    serverName: string,
    config: PiMcpServerConfig,
    onClose: () => void,
  ): Promise<McpConnection> {
    // 远程 MCP（http/sse）需要代理才能访问时，用代理感知 fetch；stdio 不走网络。
    // 优先 Guru 代理设置（手动/系统模式）；未启用时回退 Electron net.fetch（Chromium 网络栈
    // 自动读取 Windows/macOS 系统代理，GFW 环境下无需在 Guru 里单独配代理）。
    let fetchFn: typeof globalThis.fetch | undefined
    try {
      const proxyUrl = await getEffectiveProxyUrl()
      fetchFn = proxyUrl ? getFetchFn(proxyUrl) : undefined
      if (!fetchFn) {
        // 懒加载：bun test 环境下顶层 import electron 会报错，必须函数内导入
        const { net } = await import('electron')
        fetchFn = net.fetch.bind(net) as typeof globalThis.fetch
      }
    } catch {
      fetchFn = undefined
    }
    const transport = createTransport(serverName, config, fetchFn)
    if (!transport) throw new Error(`无法创建 MCP transport: ${serverName}`)

    const client = new Client({ name: 'guru-pi-agent-mcp-bridge', version: '0.1.0' }, { capabilities: {} })
    await client.connect(transport, { timeout: getTimeoutMs(config) })

    let closing = false

    const previousOnError = transport.onerror
    transport.onerror = (error) => {
      previousOnError?.(error)
      if (!closing) {
        console.warn(`[Pi MCP] MCP 服务器 ${serverName} transport error:`, error)
      }
    }
    const previousOnClose = transport.onclose
    transport.onclose = () => {
      closing = true
      previousOnClose?.()
      onClose()
    }

    return {
      client,
      transport,
      close: async () => {
        closing = true
        await transport.close()
      },
    }
  }
}

const manager = new PiMcpClientManager()

/**
 * 安全：剥掉 Graphify serve 的 project_path 参数（跨目录选图：<dir>/graphify-out/graph.json），
 * 与「图谱只建在主仓库」的约定冲突，只允许主仓库默认图（2026-08-14）。
 */
export function sanitizeGraphifyToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  // 只要存在 project_path 就剥掉（不论类型）：跨目录选图与「图谱只建在主仓库」约定冲突
  if ('project_path' in args) {
    const { project_path: _dropped, ...rest } = args
    return rest
  }
  return args
}

function createPiMcpToolDefinition(binding: McpToolBinding): ToolDefinition {
  const toolName = mcpToolName(binding.serverName, binding.originalToolName)
  const isGraphify = binding.serverName === 'graphify'
  // Graphify serve 无 explain 工具：只给 2 个核心工具补组合套路（query_graph 找相关代码、
  // get_neighbors 影响面分析），避免 10 个工具重复追加同一段描述浪费每轮 token（2026-08-14 review）。
  const graphifyCombo = isGraphify && (binding.originalToolName === 'query_graph' || binding.originalToolName === 'get_neighbors')
    ? '\n[Graphify 组合套路] 影响面分析：先 get_node 定位目标，再 get_neighbors 查入边/出边调用关系（等同 explain）；依赖路径用 shortest_path；找相关代码用 query_graph。'
    : ''
  const description = (binding.tool.description || `Call MCP tool ${binding.originalToolName} from server ${binding.serverName}`) + graphifyCombo

  return {
    name: toolName,
    label: toolName,
    description,
    promptSnippet: `${toolName}: ${description}`,
    parameters: toTypeBoxSchema(binding.tool.inputSchema),
    async execute(_toolCallId, params, signal) {
      const args = isObjectSchema(params) ? params as Record<string, unknown> : {}
      const safeArgs = isGraphify ? sanitizeGraphifyToolArgs(args) : args
      const result = await binding.manager.callTool(binding.serverName, binding.managerConfig, binding.originalToolName, safeArgs, signal)
      return convertMcpResult(result)
    },
  } as ToolDefinition
}

/**
 * 将 Guru 已构建的 MCP server 配置转换为 Pi customTools。
 *
 * 注意：本函数仅供 Pi runtime 使用；Claude runtime 仍直接把 mcpServers 交给
 * Claude Agent SDK，不经过这里。
 */
export async function buildPiMcpTools(mcpServers: PiMcpServers): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = []
  const seenToolNames = new Set<string>()

  // 并行连接所有 MCP 服务器，避免串行等待导致启动慢
  const entries = Object.entries(mcpServers).filter(([, rawConfig]) => {
    const type = (rawConfig as PiMcpServerConfig).type
    return type === 'stdio' || type === 'http' || type === 'sse'
  })

  const results = await Promise.allSettled(
    entries.map(async ([serverName, rawConfig]) => {
      const config = rawConfig as PiMcpServerConfig
      const mcpTools = config.required === false
        ? await listOptionalMcpTools(manager, serverName, config)
        : await listRequiredMcpTools(manager, serverName, config)
      if (!mcpTools) {
        console.info(`[Pi MCP] 可选 MCP 服务器 ${serverName} 尚在后台启动，本回合跳过`)
        return { serverName, config, mcpTools: [] }
      }
      return { serverName, config, mcpTools }
    }),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('[Pi MCP] 连接或列出 MCP 服务器工具失败，已跳过:', result.reason)
      continue
    }
    const { serverName, config, mcpTools } = result.value
    for (const tool of mcpTools) {
      const piToolName = mcpToolName(serverName, tool.name)
      if (seenToolNames.has(piToolName)) {
        console.warn(`[Pi MCP] 工具名冲突 ${piToolName}，已跳过 ${serverName}/${tool.name}`)
        continue
      }
      seenToolNames.add(piToolName)
      tools.push(createPiMcpToolDefinition({
        serverName,
        originalToolName: tool.name,
        tool,
        manager,
        managerConfig: config,
      }))
    }
  }

  if (tools.length > 0) {
    console.log(`[Pi MCP] 已桥接 ${tools.length} 个用户 MCP 工具到 Pi customTools`)
  }

  return tools
}

/**
 * 关闭所有 MCP 连接。应在 app quit 时调用以清理 stdio 子进程。
 */
export async function disposePiMcpConnections(): Promise<void> {
  await manager.dispose()
}
