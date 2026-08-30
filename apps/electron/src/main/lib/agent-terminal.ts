/**
 * AgentTerminalController — 会话内嵌终端（PTY）控制器
 *
 * 主进程侧持有终端实例的 node-pty 进程（cwd 与 Agent 执行目录一致），
 * 通过 IPC 与渲染进程 xterm.js 桥接：
 *  - open / write / resize / close / close-session / get-state（渲染 → 主）
 *  - TERMINAL_DATA（主 → 渲染，onData 推送）
 *  - TERMINAL_STATE_CHANGED（主 → 渲染，打开/退出状态）
 *
 * 多终端模型：一个 Agent 会话可打开多个终端实例，terminalId = `<sessionId>#<instanceId>`。
 * 实例级操作（write/resize/close）按 terminalId 定位；会话级操作（close-session）按前缀清理。
 *
 * 生命周期：面板关闭（closeSession）或单个 tab 关闭（close）即 kill 对应 pty；
 * 会话内 pty 仍在运行时重复 open 复用（不丢 shell 状态）；shell 退出后 open 重新 spawn。
 */

import { BrowserWindow } from 'electron'
import type { IPty } from 'node-pty'
import {
  AGENT_IPC_CHANNELS,
  type TerminalCloseInput,
  type TerminalOpenInput,
  type TerminalResizeInput,
  type TerminalViewState,
  type TerminalWriteInput,
  type TerminalProfile,
} from '@guru/shared'
import { chmodSync, existsSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { appendTerminalOutput, readTerminalOutput, type TerminalOutputBuffer, type TerminalOutputReadOptions, type TerminalOutputReadResult } from './terminal-output-buffer'

// CJS bundle（esbuild format=cjs）下 import.meta 为空对象；用 __filename 保证 createRequire 有效。
const require = createRequire(__filename)

export function buildTerminalId(sessionId: string, instanceId: number): string {
  return `${sessionId}#${instanceId}`
}

interface TerminalEntry {
  terminalId: string
  sessionId: string
  instanceId: number
  title?: string
  cwd: string
  shell: string
  pty: IPty
  cols: number
  rows: number
  running: boolean
  exitCode: number | null
  /** 输出滚动缓冲：预启动期间无订阅者时的数据暂存，面板挂载后 drain 回放 */
  buffer: string
  /** Agent 回读缓冲：带字符偏移的 PTY 输出（TerminalRead 工具读取，不受 drain 影响） */
  readbackBuffer: TerminalOutputBuffer
  /** warmup 预启动时间戳；仅 warmup 实例设置（用于空闲回收） */
  warmupAt: number | null
  /** 用户是否打开过面板（true 后不再被空闲回收，随 tab 关闭/面板关闭清理） */
  panelOpened: boolean
}

/** 输出缓冲上限（128KB），超出后丢弃最旧内容。 */
const MAX_TERMINAL_BUFFER = 128 * 1024
/** warmup 预启动的空闲回收超时：超过该时长仍未打开面板则自动 kill。 */
const WARMUP_IDLE_TIMEOUT_MS = 10 * 60 * 1000
/** 空闲回收检查间隔。 */
const IDLE_CHECK_INTERVAL_MS = 60 * 1000

/** 解析默认 shell 路径（macOS 优先用户 SHELL，Windows 用 PowerShell）；支持 profile 覆盖。 */
function resolveShellPath(profile?: TerminalProfile): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    switch (profile) {
      case 'pwsh': return { shell: 'pwsh.exe', args: ['-NoLogo', '-NoExit', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; chcp 65001 > $null'] }
      case 'powershell': return { shell: 'powershell.exe', args: ['-NoLogo', '-NoExit', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; chcp 65001 > $null'] }
      case 'cmd': return { shell: 'cmd.exe', args: ['/K'] }
      case 'git-bash': {
        // 尝试常见 Git Bash 安装路径，找不到回退 PowerShell。
        const candidates = [
          'C:\\Program Files\\Git\\bin\\bash.exe',
          'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
          join(process.env.LOCALAPPDATA ?? '', 'Programs\\Git\\bin\\bash.exe'),
        ]
        for (const candidate of candidates) {
          try {
            if (existsSync(candidate)) return { shell: candidate, args: ['--login', '-i'] }
          } catch { /* keep trying */ }
        }
        return { shell: 'powershell.exe', args: ['-NoLogo'] }
      }
      case 'wsl': return { shell: 'wsl.exe', args: ['--cd', '~'] }
      default: return { shell: 'powershell.exe', args: ['-NoLogo', '-NoExit', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; chcp 65001 > $null'] }
    }
  }
  const shell = process.env.SHELL?.trim() || '/bin/zsh'
  // 交互式登录 shell：读取用户 rc 文件，对齐系统终端体验
  const name = shell.split('/').pop() ?? ''
  const args = name.includes('zsh') || name.includes('bash') ? ['-l'] : []
  return { shell, args }
}

/**
 * node-pty 的 spawn-helper 在部分安装/打包场景下缺少可执行位，
 * best-effort chmod（与 synara ensureNodePtySpawnHelperExecutable 同理）。
 *
 * 打包（electron-builder asar）环境下：node-pty 的 JS 在 asar 归档内，
 * require.resolve 返回 `app.asar/...` 路径，而真实文件在可写的
 * `app.asar.unpacked/...`；对 asar 内路径 chmod 必然失败（只读归档）。
 * 因此候选路径同时尝试原始路径与 `app.asar → app.asar.unpacked` 变体。
 */
function ensureSpawnHelperExecutable(): void {
  try {
    if (process.platform === 'win32') return
    const packageJsonPath = require.resolve('node-pty/package.json')
    const packageDir = dirname(packageJsonPath)
    const candidates = [
      join(packageDir, 'build', 'Release', 'spawn-helper'),
      join(packageDir, 'build', 'Debug', 'spawn-helper'),
      join(packageDir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
    ]
    // asar 打包后真实文件位于 app.asar.unpacked；把候选路径映射到 unpacked 变体
    const realCandidates: string[] = []
    for (const candidate of candidates) {
      if (!realCandidates.includes(candidate)) realCandidates.push(candidate)
      const unpacked = candidate.replace('app.asar', 'app.asar.unpacked')
      if (!realCandidates.includes(unpacked)) realCandidates.push(unpacked)
    }
    for (const candidate of realCandidates) {
      try {
        statSync(candidate)
        chmodSync(candidate, 0o755)
        return
      } catch {
        // 继续尝试下一个候选路径
      }
    }
  } catch {
    // spawn-helper 权限修正失败不阻断终端启动（部分平台无需 helper）
  }
}

export class AgentTerminalController {
  private owner: BrowserWindow | null = null
  private readonly entries = new Map<string, TerminalEntry>()
  private idleTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly warmupIdleTimeoutMs: number = WARMUP_IDLE_TIMEOUT_MS,
    private readonly idleCheckIntervalMs: number = IDLE_CHECK_INTERVAL_MS,
  ) {}

  setOwnerWindow(window: BrowserWindow): void {
    this.owner = window
  }

  /** 打开（或复用）终端实例；cwd 必须已由调用方解析为存在的目录。 */
  open(input: TerminalOpenInput & { cwd: string }): TerminalViewState {
    const terminalId = buildTerminalId(input.sessionId, input.instanceId)
    const existing = this.entries.get(terminalId)
    if (existing) {
      if (input.title && existing.title !== input.title) existing.title = input.title
    }
    if (existing) {
      if (existing.running && existing.cwd === input.cwd) {
        // 面板重开/切换 tab 时复用正在运行的 pty（shell 状态不丢失）
        if (!input.warmup) existing.panelOpened = true
        return this.buildState(existing)
      }
      // shell 已退出，或会话改绑工作区/项目导致 cwd 变化：销毁旧 pty，按新 cwd 重新 spawn。
      // 若只是复用旧 pty，终端会停留在已失效的旧目录（如改绑前预热在 Movies 的 shell）。
      try { existing.pty.kill() } catch { /* noop */ }
      this.entries.delete(terminalId)
    }

    ensureSpawnHelperExecutable()
    // node-pty 原生模块：保持 lazy require，避免渲染进程/非终端场景加载
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ptyModule = require('node-pty') as typeof import('node-pty')
    const { shell, args } = resolveShellPath(input.profile)
    const cols = Math.max(2, Math.floor(input.cols) || 80)
    const rows = Math.max(2, Math.floor(input.rows) || 24)

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    }

    let pty: IPty
    try {
      if (process.platform === 'win32') {
        pty = ptyModule.spawn(shell, args, {
          cols,
          rows,
          cwd: input.cwd,
          env,
          name: 'xterm-256color',
          useConpty: true,
        })
      } else {
        pty = ptyModule.spawn(shell, args, {
          cols,
          rows,
          cwd: input.cwd,
          env,
          name: 'xterm-256color',
        })
      }
    } catch (error) {
      throw new Error(`无法启动终端：${error instanceof Error ? error.message : String(error)}`)
    }

    const entry: TerminalEntry = {
      terminalId,
      sessionId: input.sessionId,
      instanceId: input.instanceId,
      title: input.title,
      cwd: input.cwd,
      shell,
      pty,
      cols,
      rows,
      running: true,
      exitCode: null,
      buffer: '',
      readbackBuffer: { output: '', sequence: 0, startOffset: 0, endOffset: 0 },
      warmupAt: input.warmup ? Date.now() : null,
      panelOpened: !input.warmup,
    }
    this.entries.set(terminalId, entry)
    if (input.warmup) this.ensureIdleReaper()

    pty.onData((data: string) => {
      // 旧 pty 被 cwd 变化/重开替换后，其迟到的输出/退出事件必须忽略，
      // 否则会污染同 terminalId 的新实例（buffer 串数据、把新 pty 误标为退出）。
      const current = this.entries.get(terminalId)
      if (!current || current.pty !== pty) return
      // 滚动缓冲（截断保留最近内容），供面板挂载后回放
      current.buffer = (current.buffer + data).slice(-MAX_TERMINAL_BUFFER)
      // Agent 回读缓冲：带偏移的完整输出流（供 TerminalRead 工具分页读取）
      current.readbackBuffer = appendTerminalOutput(
        current.readbackBuffer,
        { sequence: 0, data },
        MAX_TERMINAL_BUFFER,
      )
      this.emit(AGENT_IPC_CHANNELS.TERMINAL_DATA, { terminalId, data } satisfies TerminalDataEventLike)
    })
    pty.onExit(({ exitCode }) => {
      // kill 旧 pty 后其 onExit 异步触发时，entries 可能已被同 terminalId 的新 pty 替换；
      // 必须按 pty 实例核对，避免把新终端标记为已退出并连锁误杀。
      const current = this.entries.get(terminalId)
      if (!current || current.pty !== pty) return
      current.running = false
      current.exitCode = exitCode
      this.emit(AGENT_IPC_CHANNELS.TERMINAL_STATE_CHANGED, { state: this.buildState(current) })
    })

    if (!input.warmup) {
      this.emit(AGENT_IPC_CHANNELS.TERMINAL_STATE_CHANGED, { state: this.buildState(entry) })
    }
    return this.buildState(entry)
  }

  write(input: TerminalWriteInput): void {
    const entry = this.entries.get(input.terminalId)
    if (!entry || !entry.running) return
    try {
      entry.pty.write(input.data)
    } catch {
      // pty 已销毁时静默丢弃输入
    }
  }

  resize(input: TerminalResizeInput): void {
    const entry = this.entries.get(input.terminalId)
    if (!entry || !entry.running) return
    const cols = Math.max(2, Math.floor(input.cols) || entry.cols)
    const rows = Math.max(2, Math.floor(input.rows) || entry.rows)
    if (cols === entry.cols && rows === entry.rows) return
    entry.cols = cols
    entry.rows = rows
    try {
      entry.pty.resize(cols, rows)
    } catch {
      // shell 正在退出等场景 resize 可能失败，忽略
    }
  }

  /** 关闭单个终端实例。 */
  close(input: TerminalCloseInput): TerminalViewState | null {
    const entry = this.entries.get(input.terminalId)
    if (!entry) return null
    entry.running = false
    entry.exitCode = null
    const state = this.buildState(entry)
    try { entry.pty.kill() } catch { /* noop */ }
    this.entries.delete(input.terminalId)
    return state
  }

  /** 关闭会话的全部终端实例（面板整体关闭时调用）。 */
  closeSession(sessionId: string): void {
    const prefix = `${sessionId}#`
    for (const [terminalId, entry] of this.entries) {
      if (!terminalId.startsWith(prefix)) continue
      try { entry.pty.kill() } catch { /* noop */ }
      this.entries.delete(terminalId)
    }
  }

  getState(terminalId: string): TerminalViewState | null {
    const entry = this.entries.get(terminalId)
    return entry ? this.buildState(entry) : null
  }

  /** 拉取并清空输出缓冲（面板挂载时回放预启动期间的历史输出）。 */
  drainBuffer(terminalId: string): string {
    const entry = this.entries.get(terminalId)
    if (!entry) return ''
    // 保留缓冲区而不清空：面板隐藏后重新打开时能看到历史输出，而非白屏
    return entry.buffer
  }

  /** Agent 回读终端输出（TerminalRead 工具用，带 offset 分页）。 */
  readOutput(terminalId: string, options: TerminalOutputReadOptions = {}): TerminalOutputReadResult | null {
    const entry = this.entries.get(terminalId)
    if (!entry) return null
    return readTerminalOutput(entry.readbackBuffer, options)
  }

  /** 应用退出/主窗口销毁时清理所有 pty。 */
  disposeAll(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
    for (const entry of this.entries.values()) {
      try { entry.pty.kill() } catch { /* noop */ }
    }
    this.entries.clear()
  }

  /** 懒启动空闲回收定时器（仅存在 warmup 实例时运行）。 */
  private ensureIdleReaper(): void {
    if (this.idleTimer) return
    this.idleTimer = setInterval(() => this.reapIdleWarmups(), this.idleCheckIntervalMs)
  }

  /** 回收超时未打开面板的 warmup 实例，防止长时间挂机累积后台 shell。 */
  private reapIdleWarmups(): void {
    const now = Date.now()
    for (const [terminalId, entry] of this.entries) {
      if (entry.panelOpened) continue
      if (!entry.warmupAt) continue
      if (now - entry.warmupAt < this.warmupIdleTimeoutMs) continue
      try { entry.pty.kill() } catch { /* noop */ }
      this.entries.delete(terminalId)
    }
    // 没有终端实例时停掉定时器（避免空转）
    if (this.entries.size === 0 && this.idleTimer) {
      clearInterval(this.idleTimer)
      this.idleTimer = null
    }
  }

  private buildState(entry: TerminalEntry): TerminalViewState {
    return {
      terminalId: entry.terminalId,
      sessionId: entry.sessionId,
      instanceId: entry.instanceId,
      title: entry.title,
      cwd: entry.cwd,
      shell: entry.shell,
      pid: entry.running ? entry.pty.pid : null,
      running: entry.running,
      exitCode: entry.exitCode,
      cols: entry.cols,
      rows: entry.rows,
    }
  }

  private emit(channel: string, payload: unknown): void {
    if (!this.owner || this.owner.isDestroyed()) return
    this.owner.webContents.send(channel, payload)
  }
}

/** 终端输出推送负载（与 shared TerminalDataEvent 对齐，本地声明避免循环依赖）。 */
interface TerminalDataEventLike {
  terminalId: string
  data: string
}

/** 全局单例：ipc.ts / index.ts 共享。 */
export const agentTerminalController = new AgentTerminalController()

/**
 * 读取指定会话/终端的输出（TerminalRead 工具入口）。
 * 返回 null 表示终端不存在；读不到内容时返回空输出结果。
 */
export function readAgentTerminalOutput(
  sessionId: string,
  terminalId: string,
  options: TerminalOutputReadOptions = {},
): TerminalOutputReadResult {
  const result = agentTerminalController.readOutput(terminalId, options)
  if (!result) {
    throw new Error(`Agent 终端不存在: ${terminalId}（会话 ${sessionId}）`)
  }
  return result
}

// ===== Agent 终端工具服务（移植自 Proma e23b1f39/c4dc874d） =====
// Agent 可通过 TerminalOpen/Execute/List/Interrupt/Close/Read 工具创建并操作
// 自己会话归属的可见终端。复用 agentTerminalController（node-pty），
// instanceId 用独立计数器（1000+）避免与渲染层 UI 终端的实例号冲突。

/** Agent 终端记录（工具返回给 Agent 的元数据）。 */
export interface AgentTerminalRecord {
  sessionId: string
  terminalId: string
  title: string
  cwd: string
  status: 'running' | 'exited'
}

/** 已打开的 Agent 终端记录（terminalId → record）。 */
const agentTerminals = new Map<string, AgentTerminalRecord>()
/** Agent 终端独立实例计数器（与 UI 终端的 instanceId 空间隔离）。 */
let agentTerminalInstanceCounter = 1000

/**
 * 解析 Agent 终端初始 cwd 到会话已授权目录（移植自 Proma terminal-agent-policy）。
 * 注意：这不是 OS sandbox——交互 shell 用户拥有本机 shell 本身的文件访问能力，
 * cwd 不能当作命令权限边界。
 */
function resolveAgentTerminalCwd(input: {
  cwd?: string
  sessionCwd?: string
  allowedRoots?: string[]
  /** true = 严格（无效 cwd 抛错，用于 TerminalExecute）；false = 宽松（无效 cwd 回退会话目录，用于 TerminalOpen） */
  strict?: boolean
}): string {
  const fallback = input.sessionCwd
  if (!fallback) throw new Error('当前 Agent 会话没有可用工作目录')
  const cwd = resolve(fallback, input.cwd || '.')
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    // 移植自 Proma a2b0e45e：目录被移除后重新打开时保留可用终端体验，而不是把失效 cwd 传给 PTY
    if (!input.strict) return fallback
    throw new Error('终端工作目录不存在或不是目录')
  }

  // 比较规范真实路径，阻止将授权目录内、指向外部位置的 symlink 当作 cwd 传入。
  const realCwd = realpathSync(cwd)
  const roots = [...new Set([fallback, ...(input.allowedRoots ?? [])])]
    .filter((root) => existsSync(root) && statSync(root).isDirectory())
    .map((root) => realpathSync(root))
  if (!roots.some((root) => isPathWithin(realCwd, root))) {
    throw new Error('终端初始工作目录不在当前 Agent 会话的授权范围内')
  }
  return realCwd
}

function isPathWithin(candidate: string, root: string): boolean {
  const path = resolve(candidate)
  const parent = resolve(root)
  const relation = relative(parent, path)
  return relation === '' || (!relation.startsWith('..') && !relation.includes(`${sep}..${sep}`) && !relation.startsWith(sep))
}

/** 打开一个 Agent 可见终端（工具 TerminalOpen）。 */
export function openAgentTerminal(input: {
  sessionId: string
  cwd?: string
  sessionCwd?: string
  allowedRoots?: string[]
  title?: string
  /** true = 无效 cwd 抛错（TerminalExecute）；false = 回退会话目录（TerminalOpen） */
  strict?: boolean
  /** 请求的 shell profile（default 用平台默认） */
  profile?: TerminalProfile
}): AgentTerminalRecord {
  const cwd = resolveAgentTerminalCwd(input)
  const instanceId = agentTerminalInstanceCounter++
  const terminalId = buildTerminalId(input.sessionId, instanceId)
  const title = input.title?.trim().slice(0, 80) || 'Agent 终端'
  agentTerminalController.open({
    sessionId: input.sessionId,
    instanceId,
    cwd,
    cols: 80,
    rows: 24,
    warmup: false,
    profile: input.profile,
    title: input.title,
  })
  const record: AgentTerminalRecord = { sessionId: input.sessionId, terminalId, title, cwd, status: 'running' }
  agentTerminals.set(terminalId, record)
  return record
}

/** 在 Agent 可见终端执行一条完整命令（工具 TerminalExecute）。 */
export function executeAgentTerminal(input: {
  sessionId: string
  command: string
  cwd?: string
  sessionCwd?: string
  allowedRoots?: string[]
  title?: string
  profile?: TerminalProfile
}): AgentTerminalRecord {
  const command = input.command.trim()
  if (!command || command.length > 64 * 1024) throw new Error('终端命令为空或过长')
  const title = input.title?.trim() || `Agent · ${command.replace(/\s+/g, ' ').slice(0, 48)}`
  const record = openAgentTerminal({ ...input, title, strict: true })
  agentTerminalController.write({ terminalId: record.terminalId, data: `${command}\r` })
  return record
}

/** 列出当前会话的 Agent 终端（工具 TerminalList）。 */
export function listAgentTerminals(sessionId: string): AgentTerminalRecord[] {
  return [...agentTerminals.values()].filter((record) => record.sessionId === sessionId)
}

/** 中断（Ctrl+C）一个 Agent 终端（工具 TerminalInterrupt）。 */
export function interruptAgentTerminal(sessionId: string, terminalId: string): void {
  const record = agentTerminals.get(terminalId)
  if (!record || record.sessionId !== sessionId) {
    throw new Error(`Agent 终端不存在: ${terminalId}（会话 ${sessionId}）`)
  }
  agentTerminalController.write({ terminalId, data: '\u0003' })
}

/** 关闭一个 Agent 终端（工具 TerminalClose）。 */
export function closeAgentTerminal(sessionId: string, terminalId: string): void {
  const record = agentTerminals.get(terminalId)
  if (!record || record.sessionId !== sessionId) {
    throw new Error(`Agent 终端不存在: ${terminalId}（会话 ${sessionId}）`)
  }
  agentTerminalController.close({ terminalId })
  agentTerminals.delete(terminalId)
}

/** 会话删除/结束时回收其全部 Agent 终端。 */
export function closeAgentTerminalsForSession(sessionId: string): void {
  for (const [terminalId, record] of agentTerminals) {
    if (record.sessionId === sessionId) {
      agentTerminalController.close({ terminalId })
      agentTerminals.delete(terminalId)
    }
  }
}
