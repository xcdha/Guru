/**
 * Agent 会话内嵌终端（PTY）类型定义
 *
 * 架构：主进程 node-pty 持有真实 shell 进程（cwd 与 Agent 执行目录一致），
 * 渲染进程 xterm.js 负责展示与交互，两者通过 IPC 桥接。
 *
 * 多终端模型：一个 Agent 会话可打开多个终端实例（面板内 tab），
 * 每个实例有全局唯一 terminalId（`<sessionId>#<instanceId>`，主进程/渲染层同规则生成）。
 *  - 渲染 → 主：open / write / resize / close / close-session / get-state
 *  - 主 → 渲染：data 推送（onData）、state-changed 推送（打开/退出）
 *
 * 生命周期：终端面板关闭（或单个 tab 关闭）即销毁对应 pty；重新打开重新 spawn。
 * 切换会话 tab 不销毁 pty（后台保留，重开面板复用 running 实例）。
 */

/** 主进程侧终端会话快照，用于渲染进程恢复/展示状态。 */
export interface TerminalViewState {
  /** 全局唯一终端实例 ID：`<sessionId>#<instanceId>` */
  terminalId: string
  sessionId: string
  /** 会话内实例序号（从 0 递增），用于 tab 标签排序 */
  instanceId: number
  /** 可选标题（Agent 终端为执行的命令） */
  title?: string
  /** pty 启动目录（与 Agent 执行 cwd 一致） */
  cwd: string
  /** shell 可执行文件路径（如 /bin/zsh） */
  shell: string
  /** 进程 PID；未启动或已退出时为 null */
  pid: number | null
  /** shell 是否仍在运行 */
  running: boolean
  /** 退出码；尚未退出为 null */
  exitCode: number | null
  /** pty 当前列数 */
  cols: number
  /** pty 当前行数 */
  rows: number
}

/** 打开终端（渲染 → 主） */
export interface TerminalOpenInput {
  sessionId: string
  /** 会话内实例序号（渲染层递增生成，主进程按同规则拼 terminalId） */
  instanceId: number
  /** 初始列数（xterm 挂载后首次 fit 的近似值） */
  cols: number
  rows: number
  /** 请求的 shell profile（default 用平台默认 shell；可选 pwsh/powershell/cmd/git-bash/wsl/bash/zsh） */
  /** 可选标题（Agent 终端用于展示执行的命令） */
  title?: string
  profile?: TerminalProfile
  /**
   * 预启动标记：会话激活时后台预热 shell（不推送 STATE_CHANGED，避免误触发面板）；
   * 用户点开面板时 open 复用 running pty + 回放输出缓冲，达到零等待体验。
   */
  warmup?: boolean
}

/** 写入输入（渲染 → 主） */
export interface TerminalWriteInput {
  terminalId: string
  data: string
}

/** 调整尺寸（渲染 → 主） */
export interface TerminalResizeInput {
  terminalId: string
  cols: number
  rows: number
}

/** 关闭单个终端实例（渲染 → 主） */
export interface TerminalCloseInput {
  terminalId: string
}

/** 终端输出推送（主 → 渲染） */
export interface TerminalDataEvent {
  terminalId: string
  data: string
}

/** 终端状态推送（主 → 渲染；打开成功 / 退出 / 错误时发送） */
export interface TerminalStateEvent {
  state: TerminalViewState
}

// ===== 3aec28f9: Agent 终端 shell profile 选择（移植自 Proma） =====
export type TerminalProfile = 'default' | 'zsh' | 'bash' | 'pwsh' | 'powershell' | 'cmd' | 'git-bash' | 'wsl'


const POSIX_TERMINAL_PROFILES = ['default', 'zsh', 'bash'] as const
const WINDOWS_TERMINAL_PROFILES = ['default', 'pwsh', 'powershell', 'cmd', 'git-bash', 'wsl'] as const

export function getTerminalProfilesForPlatform(platform: string): readonly TerminalProfile[] {
  if (platform === 'win32') return WINDOWS_TERMINAL_PROFILES
  if (platform === 'darwin' || platform === 'linux') return POSIX_TERMINAL_PROFILES
  return ['default']
}

/** 防止 profile 在不支持它的平台上静默解析为另一个 shell。 */

export function assertTerminalProfileSupported(profile: TerminalProfile, platform: string): TerminalProfile {
  if (getTerminalProfilesForPlatform(platform).includes(profile)) return profile
  throw new Error(`shell ${profile} 不支持当前平台 ${platform}；可选值：${getTerminalProfilesForPlatform(platform).join('、')}`)
}


export interface TerminalCreateInput {
  terminalId: string
  /** 终端所属 Agent 会话；主进程据此在会话删除时回收 PTY。 */
  sessionId: string
  cwd?: string
  profile?: TerminalProfile
  cols: number
  rows: number
}


export interface TerminalInput {
  terminalId: string
  data: string
}


export interface TerminalState {
  terminalId: string
  title: string
  cwd: string
  profile: TerminalProfile
  pid: number
}


export interface TerminalOutputEvent {
  terminalId: string
  /** 单终端单调递增，用于重连去重与 ACK。 */
  sequence: number
  data: string
}


export interface TerminalOutputAck {
  terminalId: string
  sequence: number
}

/**
 * 终端视图重挂载时的受控恢复材料。output 是有限滚动缓冲，sequence 表示其末尾。
 */

export interface TerminalSnapshot {
  state: TerminalState
  output: string
  sequence: number
}

/** 主进程通知 Renderer：Agent 已创建一个应呈现在其右侧工作区的终端。 */

export interface AgentTerminalOpenEvent {
  sessionId: string
  terminalId: string
  title: string
  cwd: string
  profile?: TerminalProfile
}


export interface AgentTerminalCloseEvent {
  sessionId: string
  terminalId: string
}


export interface TerminalExitEvent {
  terminalId: string
  exitCode: number
  signal?: number
}


export function isTerminalProfile(value: unknown): value is TerminalProfile {
  return value === 'default'
    || value === 'zsh'
    || value === 'bash'
    || value === 'pwsh'
    || value === 'powershell'
    || value === 'cmd'
    || value === 'git-bash'
    || value === 'wsl'
}

/**
 * 把外部输入（如 Agent 工具参数）解析为 TerminalProfile。
 * 省略或空串回退到 default；显式传入未知值时抛错而非静默回退，
 * 避免调用方误以为终端运行在指定 shell 上。
 */

export function parseTerminalProfile(value: unknown): TerminalProfile {
  if (value === undefined || value === null || value === '') return 'default'
  if (isTerminalProfile(value)) return value
  throw new Error(`shell 无效：${String(value)}。可选值：default、pwsh、powershell、cmd、git-bash、wsl、bash、zsh`)
}

