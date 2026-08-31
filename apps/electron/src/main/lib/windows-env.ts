/**
 * Windows 环境变量加载模块
 *
 * 问题背景：
 * Windows 上通过桌面快捷方式/开始菜单启动的 GUI 应用，
 * 可能无法继承用户在系统环境变量中配置的完整 PATH。
 * macOS 有 loadShellEnv() 解决此问题，Windows 缺少对应机制。
 *
 * 解决方案：
 * 从 Windows 注册表读取用户级和系统级 PATH，
 * 合并到 process.env.PATH，确保 scoop、chocolatey 等安装的工具可被发现。
 */

import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { ShellEnvResult } from '@guru/shared'

const PATH_SEP = ';'

/**
 * 获取 reg.exe 绝对路径。
 *
 * GUI 应用（尤其从快捷方式/更新器启动）的 process.env.PATH 可能不完整，
 * 此时裸 `reg` 命令会因 PATH 中缺少 System32 而无法执行，导致注册表读取失败
 * （鸡生蛋问题：PATH 不完整 → 无法读注册表 → 无法修复 PATH）。
 * 使用 SystemRoot 拼接绝对路径，不依赖 PATH。
 */
function getRegExePath(): string {
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || process.env.windir || process.env.WINDIR
  return systemRoot ? join(systemRoot, 'System32', 'reg.exe') : 'reg.exe'
}

/**
 * 从 Windows 注册表读取值
 *
 * @param key - 注册表键路径
 * @param valueName - 值名称
 * @returns 值内容，失败返回 null
 */
export function readRegistryValue(key: string, valueName: string): string | null {
  try {
    const output = execSync(
      `"${getRegExePath()}" query "${key}" /v "${valueName}"`,
      {
        encoding: 'utf-8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )

    const escaped = valueName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = output.match(new RegExp(`${escaped}\\s+REG_\\w+\\s+(.+)`, 'i'))
    return match?.[1]?.trim() || null
  } catch {
    return null
  }
}

export function getGitForWindowsInstallPath(): string | null {
  let path = readRegistryValue('HKLM\\SOFTWARE\\GitForWindows', 'InstallPath')
  if (path) return path
  path = readRegistryValue('HKCU\\SOFTWARE\\GitForWindows', 'InstallPath')
  return path
}

export function getNodeInstallPathFromRegistry(): string | null {
  if (process.platform !== 'win32') return null
  let path = readRegistryValue('HKLM\\SOFTWARE\\Node.js', 'InstallPath')
  if (path) return path
  path = readRegistryValue('HKCU\\SOFTWARE\\Node.js', 'InstallPath')
  return path
}

function expandEnvVars(value: string): string {
  return value.replace(/%([^%]+)%/g, (_, varName: string) => process.env[varName] || `%${varName}%`)
}

function normalizePathForCompare(p: string): string {
  return p.replace(/[/\\]+$/, '').toLowerCase()
}

function mergeRegistryPath(registryPath: string): number {
  const currentPath = process.env.PATH || ''
  const currentEntries = currentPath.split(PATH_SEP).filter(Boolean)
  const currentSet = new Set(currentEntries.map(normalizePathForCompare))
  const registryEntries = registryPath
    .split(PATH_SEP)
    .filter(Boolean)
    .map(expandEnvVars)
    .filter((p) => existsSync(p))

  let addedCount = 0
  const newEntries: string[] = []
  for (const entry of registryEntries) {
    const normalized = normalizePathForCompare(entry)
    if (!currentSet.has(normalized)) {
      currentSet.add(normalized)
      newEntries.push(entry)
      addedCount++
    }
  }

  if (addedCount > 0) process.env.PATH = [...newEntries, ...currentEntries].join(PATH_SEP)
  return addedCount
}

/**
 * 从注册表读取完整 PATH（系统级 + 用户级），展开 %VAR% 并去重。
 *
 * 用途：作为 Agent / SDK 环境的 PATH 兜底来源。GUI 应用在某些启动方式
 * （快捷方式、更新器 relaunch 等）下 process.env.PATH 可能不完整，
 * 导致 Agent 子进程无法找到用户安装的 node / python / 包管理器等工具。
 * 注册表是 Windows 的权威环境来源（新 shell 与普通用户环境都从这里合成），
 * 读取它可以让 Agent 环境与用户真实环境保持一致，对所有用户通用。
 *
 * 结果带 60 秒 TTL 缓存（成功和失败都缓存）：本函数是同步阻塞调用
 * （execSync 最多两次，各 5s 超时），而调用方 buildSdkEnvPath 在每次
 * 发送 Agent 消息时都会执行一次。若 reg.exe 被安全软件拦截或持续变慢，
 * 只缓存成功结果会导致每条消息都重新触发两次同步阻塞调用（最多卡住
 * Electron 主进程 10s），且没有退避机制会持续复现；缓存失败结果后，
 * 同一个 60s 窗口内只会尝试一次，后续直接返回上次结果（null 也回退正常）。
 *
 * @returns 合并后的 Windows PATH 字符串；读取失败或非 Windows 返回 null，调用方需回退
 */
const REGISTRY_PATH_CACHE_TTL_MS = 60_000
let cachedRegistryPath: string | null = null
let hasCachedRegistryPath = false
let cachedRegistryPathAt = 0

export function getRegistryPathFromRegistry(): string | null {
  if (process.platform !== 'win32') return null

  // 命中缓存（60s 内）：直接复用，避免重复 reg.exe 子进程调用（无论上次成功还是失败）
  const now = Date.now()
  if (hasCachedRegistryPath && now - cachedRegistryPathAt < REGISTRY_PATH_CACHE_TTL_MS) {
    return cachedRegistryPath
  }

  const entries: string[] = []
  const seen = new Set<string>()

  const addPathEntries = (raw: string | null): void => {
    if (!raw) return
    for (const entry of raw.split(PATH_SEP)) {
      const trimmed = entry.trim()
      if (!trimmed) continue
      const expanded = expandEnvVars(trimmed)
      if (!expanded) continue
      const norm = normalizePathForCompare(expanded)
      if (seen.has(norm)) continue
      seen.add(norm)
      entries.push(expanded)
    }
  }

  // 系统级 PATH
  addPathEntries(readRegistryValue(
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
    'Path',
  ))
  // 用户级 PATH
  addPathEntries(readRegistryValue('HKCU\\Environment', 'Path'))

  const result = entries.length > 0 ? entries.join(PATH_SEP) : null
  if (result === null) {
    console.warn('[Windows 环境] 从注册表读取 PATH 失败，Agent PATH 兜底不可用')
  }
  cachedRegistryPath = result
  hasCachedRegistryPath = true
  cachedRegistryPathAt = now
  return result
}

/**
 * 加载 Windows 注册表中的 PATH 到 process.env
 *
 * 从两个注册表位置读取：
 * 1. 用户级 PATH：HKCU\Environment\Path
 * 2. 系统级 PATH：HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment\Path
 *
 * @returns 加载结果
 */
export async function loadWindowsEnv(): Promise<ShellEnvResult> {
  if (process.platform !== 'win32') return { success: true, loadedCount: 0, error: null }
  if (!app.isPackaged) return { success: true, loadedCount: 0, error: null }

  console.log('[Windows 环境] 正在从注册表加载 PATH...')
  try {
    let totalAdded = 0
    const [systemPath, userPath] = await Promise.all([
      readRegistryValue(
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
        'Path',
      ),
      readRegistryValue('HKCU\\Environment', 'Path'),
    ])
    if (systemPath) {
      const added = mergeRegistryPath(systemPath)
      totalAdded += added
      console.log(`[Windows 环境] 系统 PATH: 新增 ${added} 个路径`)
    }
    if (userPath) {
      const added = mergeRegistryPath(userPath)
      totalAdded += added
      console.log(`[Windows 环境] 用户 PATH: 新增 ${added} 个路径`)
    }
    console.log(`[Windows 环境] PATH 加载完成，共新增 ${totalAdded} 个路径`)
    return { success: true, loadedCount: totalAdded, error: null }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.warn(`[Windows 环境] PATH 加载失败: ${errorMessage}`)
    return { success: false, loadedCount: 0, error: errorMessage }
  }
}
