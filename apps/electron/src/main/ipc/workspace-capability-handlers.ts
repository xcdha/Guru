/**
 * workspace-capability-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「工作区能力（MCP + Skill）」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 * 同时迁入仅被该组使用的辅助声明: workspaceMcpRefreshGenerations, workspaceMcpPendingValidations, advanceWorkspaceMcpRefreshGeneration, getWorkspaceMcpPendingValidation, setWorkspaceMcpPendingValidation, clearWorkspaceMcpPendingValidation, clearMissingWorkspaceMcpPendingValidations, isWorkspaceMcpRefreshCurrent, McpRefreshValidation, getMcpEntryFingerprint, mapWithConcurrency, mergeMcpRefreshResults, validateAndConditionallyPersistMcp, runCliProbe, isDingTalkCliAuthenticated, getCliIntegrationStatuses, CliCommandResult, CliCommandRunner, getCliProbeInvocation, runCliCommand
 */

import { getGlobalScopeReviewHints } from '../lib/agent-global-scope-migration'
import { deleteGlobalSkill, deleteWorkspaceSkill, getAllEffectiveSkills, getAllWorkspaceSkills, getDefaultSkillSlugs, getDisabledCliIntegrationIds, getOtherWorkspaceSkills, getWorkspaceCapabilities, getWorkspaceMcpConfig, saveWorkspaceMcpConfig, setCliIntegrationEnabled, toggleGlobalSkill, toggleWorkspaceSkill } from '../lib/agent-workspace-manager'
import { setBuiltinMcpUserEnabled } from '../lib/builtin-mcp/settings'
import { getWorkspaceSkillsDir } from '../lib/config-paths'
import { deleteMcpCredential, saveMcpApiKey, saveMcpOAuthClientSecret, startMcpOAuth } from '../lib/mcp-oauth-service'
import { runCmd } from '../lib/run-command'
import { AGENT_IPC_CHANNELS } from '@guru/shared'
import type { SkillMeta, WorkspaceCapabilities, WorkspaceMcpConfig } from '@guru/shared'
import { ipcMain, shell } from 'electron'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

/**
 * 每次保存或刷新都会推进工作区代数，使较早的异步 MCP 刷新不能回写较新的配置。
 * 该代数仅用于进程内竞态保护，不写入用户的 mcp.json。
 */
const workspaceMcpRefreshGenerations = new Map<string, number>()
const workspaceMcpPendingValidations = new Map<string, Map<string, import('@guru/shared').McpServerEntry>>()
function advanceWorkspaceMcpRefreshGeneration(workspaceSlug: string): number {
  const generation = (workspaceMcpRefreshGenerations.get(workspaceSlug) ?? 0) + 1
  workspaceMcpRefreshGenerations.set(workspaceSlug, generation)
  return generation
}
function getWorkspaceMcpPendingValidation(workspaceSlug: string, name: string): import('@guru/shared').McpServerEntry | undefined {
  return workspaceMcpPendingValidations.get(workspaceSlug)?.get(name)
}
function setWorkspaceMcpPendingValidation(workspaceSlug: string, name: string, entry: import('@guru/shared').McpServerEntry): void {
  const pending = workspaceMcpPendingValidations.get(workspaceSlug) ?? new Map<string, import('@guru/shared').McpServerEntry>()
  pending.set(name, entry)
  workspaceMcpPendingValidations.set(workspaceSlug, pending)
}
function clearWorkspaceMcpPendingValidation(workspaceSlug: string, name: string): void {
  const pending = workspaceMcpPendingValidations.get(workspaceSlug)
  if (!pending) return
  pending.delete(name)
  if (pending.size === 0) workspaceMcpPendingValidations.delete(workspaceSlug)
}
function clearMissingWorkspaceMcpPendingValidations(workspaceSlug: string, serverNames: ReadonlySet<string>): void {
  const pending = workspaceMcpPendingValidations.get(workspaceSlug)
  if (!pending) return
  for (const name of pending.keys()) {
    if (!serverNames.has(name)) pending.delete(name)
  }
  if (pending.size === 0) workspaceMcpPendingValidations.delete(workspaceSlug)
}
function isWorkspaceMcpRefreshCurrent(workspaceSlug: string, generation: number): boolean {
  return workspaceMcpRefreshGenerations.get(workspaceSlug) === generation
}
interface McpRefreshValidation {
  name: string
  fingerprint: string
  lastTestResult: NonNullable<import('@guru/shared').McpServerEntry['lastTestResult']>
}
/**
 * 生成 MCP 可运行配置的稳定摘要。摘要只用于内存中比较，绝不记录或返回，避免暴露 headers/env 中的敏感值。
 */
export function getMcpEntryFingerprint(entry: import('@guru/shared').McpServerEntry): string {
  const sortedEntries = (record: Record<string, string> | undefined): Array<[string, string]> =>
    Object.entries(record ?? {}).sort(([left], [right]) => left.localeCompare(right))

  const canonical = {
    type: entry.type,
    command: entry.command ?? null,
    args: entry.args ? [...entry.args] : null,
    url: entry.url ?? null,
    headers: sortedEntries(entry.headers),
    env: sortedEntries(entry.env),
    timeout: entry.timeout ?? null,
    enabled: entry.enabled,
    isBuiltin: entry.isBuiltin ?? false,
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}
/** 在固定上限内并发执行任务，保留输入顺序，避免同时启动过多 MCP 进程或网络连接。 */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  maxConcurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new Error('maxConcurrency 必须是正整数')
  }

  const results = new Array<R>(values.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex++
      results[index] = await mapper(values[index]!, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, values.length) }, worker))
  return results
}
/**
 * 只合并仍与验证开始时完全一致的条目。调用方还必须检查 refresh generation，
 * 因而同名服务器被编辑、禁用、删除或被后一次刷新取代时，旧结果不会落盘。
 */
export function mergeMcpRefreshResults(
  currentConfig: import('@guru/shared').WorkspaceMcpConfig,
  validations: readonly McpRefreshValidation[],
): import('@guru/shared').WorkspaceMcpConfig {
  const servers = { ...currentConfig.servers }
  for (const validation of validations) {
    const currentEntry = servers[validation.name]
    if (currentEntry?.enabled && getMcpEntryFingerprint(currentEntry) === validation.fingerprint) {
      servers[validation.name] = {
        ...currentEntry,
        enabled: validation.lastTestResult.success,
        lastTestResult: validation.lastTestResult,
      }
    }
  }
  return { servers }
}
/**
 * 在该条目保持 disabled 落盘的状态下验证启用候选。若验证期间配置已被改动，
 * 返回最新快照而不是覆盖它。验证失败会落盘为 disabled，确保无效 MCP 不会被运行时加载。
 */
async function validateAndConditionallyPersistMcp(
  workspaceSlug: string,
  name: string,
  candidateEntry: import('@guru/shared').McpServerEntry,
  expectedPersistedFingerprint: string,
  expectedRefreshGeneration: number,
): Promise<import('@guru/shared').McpConnectionMutationResult> {
  const { validateMcpServer } = await import('../lib/mcp-validator')
  const result = await validateMcpServer(name, candidateEntry, workspaceSlug)
  const verification = {
    success: result.valid,
    message: result.valid ? (result.message ?? 'MCP 连接成功') : (result.reason ?? 'MCP 连接失败'),
  }
  const current = getWorkspaceMcpConfig(workspaceSlug)
  const currentEntry = current.servers[name]
  if (
    !isWorkspaceMcpRefreshCurrent(workspaceSlug, expectedRefreshGeneration) ||
    !currentEntry ||
    getMcpEntryFingerprint(currentEntry) !== expectedPersistedFingerprint
  ) {
    return { config: current, verification }
  }

  const nextEntry = {
    ...candidateEntry,
    enabled: verification.success,
    lastTestResult: { ...verification, timestamp: Date.now() },
  }
  const config = { servers: { ...current.servers, [name]: nextEntry } }
  clearWorkspaceMcpPendingValidation(workspaceSlug, name)
  saveWorkspaceMcpConfig(workspaceSlug, config)
  return { config, verification }
}
async function runCliProbe(
  runner: CliCommandRunner,
  bin: string,
  args: string[],
): Promise<CliCommandResult> {
  try {
    return await runner(bin, args, { timeoutMs: 2_000 })
  } catch {
    return { status: null, stdout: '' }
  }
}
/**
 * `dws auth status --format json` 是官方的非交互认证探测。只接受其完整、成功且 token 有效的结果；
 * 不读取、返回或持久化 CLI 输出中的任何身份字段。
 */
function isDingTalkCliAuthenticated(result: CliCommandResult): boolean {
  if (result.status !== 0) return false

  try {
    const status = JSON.parse(result.stdout) as {
      success?: unknown
      authenticated?: unknown
      token_valid?: unknown
    }
    return status.success === true && status.authenticated === true && status.token_valid === true
  } catch {
    return false
  }
}
/**
 * 仅将可由 CLI 本身的认证探测确认的集成标记为已连接；命令不存在、超时、未认证和未知探测均保守为 false。
 */
export async function getCliIntegrationStatuses(
  runner: CliCommandRunner = runCliCommand,
  disabledIds: ReadonlySet<string> = new Set(),
): Promise<import('@guru/shared').CliIntegrationStatus[]> {
  const [wecom, dingtalk, github, feishu] = await Promise.all([
    runCliProbe(runner, 'wecom-cli', ['auth', 'show', '--status']),
    runCliProbe(runner, 'dws', ['auth', 'status', '--format', 'json']),
    runCliProbe(runner, 'gh', ['auth', 'status', '--active']),
    runCliProbe(runner, 'lark-cli', ['auth', 'status', '--verify']),
  ])

  return [
    { id: 'wecom-cli', connected: wecom.status === 0 && wecom.stdout.trim().toLowerCase() === 'authorized', enabled: !disabledIds.has('wecom-cli') },
    { id: 'dingtalk-cli', connected: isDingTalkCliAuthenticated(dingtalk), enabled: !disabledIds.has('dingtalk-cli') },
    { id: 'github-cli', connected: github.status === 0, enabled: !disabledIds.has('github-cli') },
    { id: 'feishu-cli', connected: feishu.status === 0, enabled: !disabledIds.has('feishu-cli') },
  ]
}
type CliCommandResult = { status: number | null; stdout: string }
type CliCommandRunner = (bin: string, args: string[], opts: { timeoutMs?: number }) => Promise<CliCommandResult>
/**
 * npm 安装的 CLI 在 Windows 上通常以 .cmd shim 暴露。把 cmd.exe 路径严格限制在
 * 固定的目录探测命令里，而不是为通用 runCmd 打开 shell。
 */
export function getCliProbeInvocation(
  bin: string,
  args: string[],
  platform = process.platform,
  comSpec = process.env.ComSpec,
): { bin: string; args: string[] } {
  if (platform !== 'win32') return { bin, args }
  return {
    bin: comSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', [bin, ...args].join(' ')],
  }
}
async function runCliCommand(bin: string, args: string[], opts: { timeoutMs?: number }): Promise<CliCommandResult> {
  const invocation = getCliProbeInvocation(bin, args)
  return runCmd(invocation.bin, invocation.args, opts)
}

export function registerWorkspaceCapabilityHandlers(): void {
  // ===== 工作区能力（MCP + Skill） =====

  // 获取工作区能力摘要
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_CAPABILITIES,
    async (_, workspaceSlug: string): Promise<WorkspaceCapabilities> => {
      return getWorkspaceCapabilities(workspaceSlug)
    }
  )

  // 获取工作区 MCP 配置（对齐上游 #2037：MCP 为工作区级存储，UI 唯一入口）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_MCP_CONFIG,
    async (_, workspaceSlug: string): Promise<WorkspaceMcpConfig> => {
      return getWorkspaceMcpConfig(workspaceSlug)
    }
  )

  // 防御式保存整个工作区 MCP 配置：renderer 传入的测试结果仅是可展示数据，不能作为加载授权。
  // 新启用或变更的条目先以 disabled 落盘，并走与卡片开关一致的真实验证后才允许启用。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SAVE_MCP_CONFIG,
    async (_, workspaceSlug: string, config: WorkspaceMcpConfig, options?: import('@guru/shared').SaveWorkspaceMcpConfigOptions): Promise<void> => {
      for (const name of options?.explicitlyDisabledServerNames ?? []) {
        clearWorkspaceMcpPendingValidation(workspaceSlug, name)
      }
      const pendingValidations: Array<{ name: string; candidate: import('@guru/shared').McpServerEntry }> = []
      const servers: WorkspaceMcpConfig['servers'] = {}

      const configServerNames = new Set(Object.keys(config.servers))
      clearMissingWorkspaceMcpPendingValidations(workspaceSlug, configServerNames)
      for (const [name, entry] of Object.entries(config.servers)) {
        const entryWithoutTestResult = { ...entry }
        delete entryWithoutTestResult.lastTestResult
        const candidate = { ...entryWithoutTestResult, enabled: true }
        if (entry.enabled) {
          // lastTestResult 是 renderer 可见的展示数据，不是可加载证明。
          // 每个 enabled 条目都必须重新真实验证，包括旧版本创建或手工编辑过的配置。
          servers[name] = { ...entryWithoutTestResult, enabled: false }
          pendingValidations.push({ name, candidate })
          setWorkspaceMcpPendingValidation(workspaceSlug, name, candidate)
        } else {
          const pendingCandidate = getWorkspaceMcpPendingValidation(workspaceSlug, name)
          const pendingEntry = pendingCandidate ? { ...pendingCandidate, enabled: false } : undefined
          if (pendingEntry && getMcpEntryFingerprint(pendingEntry) === getMcpEntryFingerprint(entry)) {
            servers[name] = pendingEntry
            pendingValidations.push({ name, candidate: pendingCandidate! })
          } else {
            clearWorkspaceMcpPendingValidation(workspaceSlug, name)
            // 不为 disabled 条目持久化 renderer 提供的验证数据。
            servers[name] = entryWithoutTestResult
          }
        }
      }

      const pendingConfig = { servers }
      const refreshGeneration = advanceWorkspaceMcpRefreshGeneration(workspaceSlug)
      saveWorkspaceMcpConfig(workspaceSlug, pendingConfig)
      for (const validation of pendingValidations) {
        await validateAndConditionallyPersistMcp(
          workspaceSlug,
          validation.name,
          validation.candidate,
          getMcpEntryFingerprint(pendingConfig.servers[validation.name]!),
          refreshGeneration,
        )
      }
    }
  )

  // 原子切换单个 MCP：任何更晚的保存都会推进工作区 refresh generation，
  // 而 fingerprint 匹配保护本条目的验证回写。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SET_MCP_ENABLED_AND_VALIDATE,
    async (_, workspaceSlug: string, name: string, enabled: boolean): Promise<import('@guru/shared').McpConnectionMutationResult> => {
      const current = getWorkspaceMcpConfig(workspaceSlug)
      const entry = current.servers[name]
      if (!entry) throw new Error('找不到 MCP 配置')

      const entryWithoutTestResult = { ...entry }
      delete entryWithoutTestResult.lastTestResult
      if (!enabled) {
        const config = { servers: { ...current.servers, [name]: { ...entry, enabled: false } } }
        advanceWorkspaceMcpRefreshGeneration(workspaceSlug)
        clearWorkspaceMcpPendingValidation(workspaceSlug, name)
        saveWorkspaceMcpConfig(workspaceSlug, config)
        return { config, verification: { success: true, message: 'MCP 已关闭' } }
      }

      // 保持条目 disabled 直到真实握手成功，避免运行时反复启动已知无效的服务器。
      const pendingEntry = { ...entryWithoutTestResult, enabled: false }
      const pendingConfig = { servers: { ...current.servers, [name]: pendingEntry } }
      // 将候选条目保留在内存中：握手期间发生无关的整配置保存时，
      // 会保留并继续验证，而不是把临时 disabled 当成用户主动关闭。
      const refreshGeneration = advanceWorkspaceMcpRefreshGeneration(workspaceSlug)
      setWorkspaceMcpPendingValidation(workspaceSlug, name, { ...entryWithoutTestResult, enabled: true })
      saveWorkspaceMcpConfig(workspaceSlug, pendingConfig)
      return validateAndConditionallyPersistMcp(
        workspaceSlug,
        name,
        { ...entryWithoutTestResult, enabled: true },
        getMcpEntryFingerprint(pendingEntry),
        refreshGeneration,
      )
    }
  )

  // 原子安装目录 MCP：已有配置优先，不被 renderer 的过期快照覆盖。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.INSTALL_MCP_AND_VALIDATE,
    async (_, workspaceSlug: string, name: string, entry: import('@guru/shared').McpServerEntry): Promise<import('@guru/shared').McpInstallMutationResult> => {
      const current = getWorkspaceMcpConfig(workspaceSlug)
      if (current.servers[name]) {
        return {
          installed: false,
          config: current,
          verification: { success: Boolean(current.servers[name]?.lastTestResult?.success), message: 'MCP 已存在' },
        }
      }

      const entryWithoutTestResult = { ...entry }
      delete entryWithoutTestResult.lastTestResult
      if (!entry.enabled) {
        const config = { servers: { ...current.servers, [name]: entryWithoutTestResult } }
        advanceWorkspaceMcpRefreshGeneration(workspaceSlug)
        saveWorkspaceMcpConfig(workspaceSlug, config)
        return { installed: true, config, verification: { success: true, message: 'MCP 已添加，等待配置' } }
      }

      // 新安装的目录 MCP 同样保持 disabled 直到验证通过。
      const pendingEntry = { ...entryWithoutTestResult, enabled: false }
      const pendingConfig = { servers: { ...current.servers, [name]: pendingEntry } }
      // 将候选条目保留在内存中：握手期间发生无关的整配置保存时，
      // 会保留并继续验证，而不是把临时 disabled 当成用户主动关闭。
      const refreshGeneration = advanceWorkspaceMcpRefreshGeneration(workspaceSlug)
      setWorkspaceMcpPendingValidation(workspaceSlug, name, { ...entryWithoutTestResult, enabled: true })
      saveWorkspaceMcpConfig(workspaceSlug, pendingConfig)
      const result = await validateAndConditionallyPersistMcp(
        workspaceSlug,
        name,
        { ...entryWithoutTestResult, enabled: true },
        getMcpEntryFingerprint(pendingEntry),
        refreshGeneration,
      )
      return { installed: true, ...result }
    }
  )

  // 刷新并持久化工作区 MCP 真实连接状态
  ipcMain.handle(
    AGENT_IPC_CHANNELS.REFRESH_MCP_CONNECTIONS,
    async (_, workspaceSlug: string): Promise<WorkspaceMcpConfig> => {
      const refreshGeneration = advanceWorkspaceMcpRefreshGeneration(workspaceSlug)
      const config = getWorkspaceMcpConfig(workspaceSlug)
      const entries = Object.entries(config.servers).filter(([, entry]) => entry.enabled)
      const { validateMcpServer } = await import('../lib/mcp-validator')
      const validations = await mapWithConcurrency(entries, 4, async ([name, entry]) => {
        const result = await validateMcpServer(name, entry, workspaceSlug)
        return {
          name,
          fingerprint: getMcpEntryFingerprint(entry),
          lastTestResult: {
            success: result.valid,
            message: result.valid ? (result.message ?? 'MCP 连接成功') : (result.reason ?? 'MCP 连接失败'),
            timestamp: Date.now(),
          },
        }
      })

      // 保存或更晚发起的刷新会使本次 generation 过期；直接返回最新完整配置，不写任何旧验证结果。
      if (!isWorkspaceMcpRefreshCurrent(workspaceSlug, refreshGeneration)) {
        return getWorkspaceMcpConfig(workspaceSlug)
      }

      const refreshed = mergeMcpRefreshResults(getWorkspaceMcpConfig(workspaceSlug), validations)
      saveWorkspaceMcpConfig(workspaceSlug, refreshed)
      return refreshed
    }
  )

  // 启动远程 MCP 的 OAuth PKCE 授权（不向 renderer 暴露任何凭据）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.START_MCP_OAUTH,
    async (_, input: import('@guru/shared').StartMcpOAuthInput): Promise<import('@guru/shared').McpOAuthStartResult> => {
      return startMcpOAuth(input)
    }
  )

  // 将 OAuth client secret 加密保存到系统 Keychain
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SAVE_MCP_OAUTH_CLIENT_SECRET,
    (_, input: import('@guru/shared').SaveMcpOAuthClientSecretInput): void => {
      saveMcpOAuthClientSecret(input)
    }
  )

  // 安全保存远程 MCP 的静态 API Key / Token
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SAVE_MCP_API_KEY,
    async (_, input: import('@guru/shared').SaveMcpApiKeyInput): Promise<void> => {
      return saveMcpApiKey(input)
    }
  )

  // renderer 先移除传输配置，再调用此 handler 只删除匹配的加密 Keychain 载荷。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_MCP_CREDENTIAL,
    async (_, workspaceSlug: string, serverName: string): Promise<void> => {
      return deleteMcpCredential(workspaceSlug, serverName)
    }
  )

  // 查询本机 CLI 集成状态（含当前工作区的启用状态；不返回任何凭据）。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_CLI_INTEGRATION_STATUSES,
    async (_, workspaceSlug: string): Promise<import('@guru/shared').CliIntegrationStatus[]> => {
      return getCliIntegrationStatuses(undefined, getDisabledCliIntegrationIds(workspaceSlug))
    }
  )

  // 仅切换 Guru 对工作区 CLI 集成的使用权限；绝不登出或撤销第三方授权。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SET_CLI_INTEGRATION_ENABLED,
    async (_, workspaceSlug: string, id: string, enabled: boolean): Promise<import('@guru/shared').CliIntegrationStatus[]> => {
      setCliIntegrationEnabled(workspaceSlug, id, enabled)
      return getCliIntegrationStatuses(undefined, getDisabledCliIntegrationIds(workspaceSlug))
    }
  )

  // 获取全局作用域迁移后续提示（遗留工作区 mcp.json / 同名冲突后缀）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_GLOBAL_SCOPE_REVIEW_HINTS,
    async (): Promise<import('@guru/shared').GlobalScopeReviewHints> => {
      return getGlobalScopeReviewHints()
    }
  )

  // 获取全局 Skills 目录绝对路径
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_GLOBAL_SKILLS_DIR,
    async (): Promise<string> => {
      const { getGlobalSkillsDir } = await import('../lib/config-paths')
      return getGlobalSkillsDir()
    }
  )

  // 测试 MCP 服务器连接（真实握手；传 workspaceSlug 以注入该工作区的 OAuth/API-key 凭据）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TEST_MCP_SERVER,
    async (_, workspaceSlug: string, name: string, entry: import('@guru/shared').McpServerEntry): Promise<{ success: boolean; message: string }> => {
      const { validateMcpServer } = await import('../lib/mcp-validator')
      const result = await validateMcpServer(name, entry, workspaceSlug)
      return {
        success: result.valid,
        message: result.valid ? (result.message ?? '连接成功') : (result.reason || '连接失败'),
      }
    }
  )

  // 测试内置连接器依赖（Chrome / npx 等，不拉起完整 MCP 会话）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TEST_BUILTIN_CONNECTOR,
    async (_, id: string): Promise<{ success: boolean; message: string }> => {
      if (id === 'chrome-devtools') {
        const { resolveChromeDevtoolsAvailability } = await import('../lib/builtin-mcp/chrome-devtools-availability')
        const result = resolveChromeDevtoolsAvailability()
        return {
          success: result.available,
          message: result.available
            ? '已检测到 Chrome 与 npx，可以启动浏览器连接器'
            : (result.reason ?? '浏览器连接器不可用'),
        }
      }
      return { success: false, message: '该连接器请在配置表单中测试' }
    }
  )

  // 启用或关闭 Guru 内置 MCP
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SET_BUILTIN_MCP_ENABLED,
    async (_, workspaceSlug: string, id: string, enabled: boolean): Promise<WorkspaceCapabilities> => {
      setBuiltinMcpUserEnabled(id, enabled)
      return getWorkspaceCapabilities(workspaceSlug)
    }
  )

  // 获取工作区 Skill 列表（含活跃和不活跃，设置页 UI 用）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_SKILLS,
    async (_, workspaceSlug: string): Promise<SkillMeta[]> => {
      return getAllWorkspaceSkills(workspaceSlug)
    }
  )

  // 获取工作区 Skills 目录绝对路径
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_SKILLS_DIR,
    async (_, workspaceSlug: string): Promise<string> => {
      return getWorkspaceSkillsDir(workspaceSlug)
    }
  )

  // 删除工作区 Skill
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_SKILL,
    async (_, workspaceSlug: string, skillSlug: string): Promise<void> => {
      return deleteWorkspaceSkill(workspaceSlug, skillSlug)
    }
  )

  // 切换工作区 Skill 启用/禁用
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TOGGLE_SKILL,
    async (_, workspaceSlug: string, skillSlug: string, enabled: boolean): Promise<void> => {
      return toggleWorkspaceSkill(workspaceSlug, skillSlug, enabled)
    }
  )

  // 获取全局+工作区+项目三层合并后的生效 Skill 列表（插件中心 UI 用，带 scope/shadowedByGlobal）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_ALL_EFFECTIVE_SKILLS,
    async (_, workspaceSlug: string | undefined, projectId?: string): Promise<SkillMeta[]> => {
      return getAllEffectiveSkills(workspaceSlug, projectId)
    }
  )

  // 删除全局 Skill
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_GLOBAL_SKILL,
    async (_, skillSlug: string): Promise<void> => {
      return deleteGlobalSkill(skillSlug)
    }
  )

  // 切换全局 Skill 启用/禁用
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TOGGLE_GLOBAL_SKILL,
    async (_, skillSlug: string, enabled: boolean): Promise<void> => {
      return toggleGlobalSkill(skillSlug, enabled)
    }
  )

  // 获取其他工作区的 Skill 列表
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_OTHER_WORKSPACE_SKILLS,
    async (_, currentSlug: string) => {
      return getOtherWorkspaceSkills(currentSlug)
    }
  )

  // 获取默认 Skills 的 slug 列表（来自 ~/.guru/default-skills/）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_DEFAULT_SKILL_SLUGS,
    async () => {
      return getDefaultSkillSlugs()
    }
  )
}
