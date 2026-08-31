/**
 * 应用设置服务
 *
 * 管理应用设置（主题模式等）的读写。
 * 存储在 ~/.guru/settings.json
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { getSettingsPath } from './config-paths'
import { DEFAULT_AGENT_RUNTIME, DEFAULT_ICON_SKIN, DEFAULT_INTERFACE_VARIANT, DEFAULT_THEME_MODE, normalizeProductivityToolsSettings } from '../../types'
import type { AppSettings } from '../../types'
import { getTerminalProfilesForPlatform, isTerminalProfile } from '@guru/shared'

export function sanitizeWindowsTerminalProfile(input: unknown): AppSettings['lastWindowsTerminalProfile'] {
  return isTerminalProfile(input) && getTerminalProfilesForPlatform('win32').includes(input)
    ? input
    : undefined
}

/**
 * 获取应用设置
 *
 * 如果文件不存在，返回默认设置。
 */
export function getSettings(): AppSettings {
  const filePath = getSettingsPath()

  if (!existsSync(filePath)) {
    return {
      themeMode: DEFAULT_THEME_MODE,
      interfaceVariant: DEFAULT_INTERFACE_VARIANT,
      iconSkin: DEFAULT_ICON_SKIN,
      onboardingCompleted: false,
      environmentCheckSkipped: false,
      notificationsEnabled: true,
      longTextPasteAsAttachmentEnabled: false,
      richTextRenderingEnabled: false,
      feishuSessionMirror: { mode: 'off' },
      visionRelay: { enabled: false },
      builtinMcpDisabledIds: [],
      sidebarModuleCollapsed: {},
      agentRuntime: DEFAULT_AGENT_RUNTIME,
      windowsShellPreference: 'auto',
      agentThinking: { type: 'adaptive' },
      defaultThinkingLevel: 'high',
      gitAttributionEnabled: true,
      productivityTools: normalizeProductivityToolsSettings(undefined),
    }
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as Partial<AppSettings> & {
      experimentalAgentRuntimeSwitchEnabled?: boolean
      /** Claude 时代遗留：渠道白名单已随 Pi-only 终态退役 */
      agentChannelIds?: string[]
      agentRuntime?: unknown
      builtinMcpDisabledIds?: unknown
      interfaceVariant?: unknown
      /** PR #1895 早期构建写入的无平台 profile 字段；仅在 Windows 上迁移。 */
      lastTerminalProfile?: unknown
    }
    // Pi runtime 已默认可用；读取时清理旧版本遗留的实验开关与 Claude 渠道白名单。
    const {
      experimentalAgentRuntimeSwitchEnabled: _legacyRuntimeSwitch,
      agentChannelIds: _legacyAgentChannelIds,
      builtinMcpDisabledIds: _legacyBuiltinMcpDisabledIds,
      interfaceVariant: _legacyInterfaceVariant,
      lastTerminalProfile: legacyLastTerminalProfile,
      ...settings
    } = data
    return {
      ...settings,
      themeMode: data.themeMode || DEFAULT_THEME_MODE,
      interfaceVariant: data.interfaceVariant || DEFAULT_INTERFACE_VARIANT,
      iconSkin: data.iconSkin ?? DEFAULT_ICON_SKIN,
      onboardingCompleted: data.onboardingCompleted ?? false,
      environmentCheckSkipped: data.environmentCheckSkipped ?? false,
      notificationsEnabled: data.notificationsEnabled ?? true,
      longTextPasteAsAttachmentEnabled: data.longTextPasteAsAttachmentEnabled ?? false,
      richTextRenderingEnabled: data.richTextRenderingEnabled ?? false,
      feishuSessionMirror: data.feishuSessionMirror ?? { mode: 'off' },
      visionRelay: data.visionRelay ?? { enabled: false },
      builtinMcpDisabledIds: data.builtinMcpDisabledIds ?? [],
      sidebarModuleCollapsed: data.sidebarModuleCollapsed ?? {},
      agentRuntime: settings.agentRuntime ?? DEFAULT_AGENT_RUNTIME,
      windowsShellPreference: settings.windowsShellPreference ?? 'auto',
      lastWindowsTerminalProfile: process.platform === 'win32'
        ? sanitizeWindowsTerminalProfile(settings.lastWindowsTerminalProfile ?? legacyLastTerminalProfile)
        : undefined,
      autoRevealAgentTerminal: settings.autoRevealAgentTerminal ?? true,
      showDelegationUi: settings.showDelegationUi ?? true,
      agentThinking: settings.agentThinking ?? { type: 'adaptive' },
      defaultThinkingLevel: settings.defaultThinkingLevel ?? 'high',
      // 缺省 true：老配置文件未写该字段时保持推广默认开启
      gitAttributionEnabled: settings.gitAttributionEnabled ?? true,
      // 缺省全部开启：老配置文件不会因升级意外隐藏生产力工具。
      productivityTools: normalizeProductivityToolsSettings(data.productivityTools),
    }
  } catch (error) {
    console.error('[设置] 读取失败:', error)
    // 备份损坏的设置文件，防止后续 updateSettings 用默认值覆盖冲掉用户历史设置。
    try {
      if (existsSync(filePath)) {
        const backupPath = `${filePath}.corrupt-${Date.now()}`
        renameSync(filePath, backupPath)
        console.error(`[设置] 已备份损坏的设置文件到: ${backupPath}`)
      }
    } catch (backupError) {
      console.error('[设置] 备份损坏设置文件失败:', backupError)
    }
    return {
      themeMode: DEFAULT_THEME_MODE,
      interfaceVariant: DEFAULT_INTERFACE_VARIANT,
      iconSkin: DEFAULT_ICON_SKIN,
      onboardingCompleted: false,
      environmentCheckSkipped: false,
      notificationsEnabled: true,
      longTextPasteAsAttachmentEnabled: false,
      richTextRenderingEnabled: false,
      feishuSessionMirror: { mode: 'off' },
      visionRelay: { enabled: false },
      builtinMcpDisabledIds: [],
      sidebarModuleCollapsed: {},
      agentRuntime: DEFAULT_AGENT_RUNTIME,
      windowsShellPreference: 'auto',
      agentThinking: { type: 'adaptive' },
      defaultThinkingLevel: 'high',
      gitAttributionEnabled: true,
      productivityTools: normalizeProductivityToolsSettings(undefined),
    }
  }
}

/**
 * 更新应用设置
 *
 * 合并更新字段并写入文件。
 */
/**
 * 模块级串行队列：确保并发的 updateSettingsAsync 调用按顺序执行，
 * 避免「读-合并-写」互相覆盖（M17）。
 */
let settingsWriteQueue: Promise<unknown> = Promise.resolve()

/**
 * 更新应用设置（同步版本）。
 *
 * 合并更新字段并写入文件。仅用于必须在返回前完成落盘的同步场景
 * （如 ipcMain.on 的 sendSync handler、beforeunload）；并发安全由
 * 调用方保证（同一时刻通常只有一个同步调用）。
 */
export function updateSettings(updates: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const updated: AppSettings = {
    ...current,
    ...updates,
    // 仅保留 macOS 原生 Island 开关，避免旧非原生 surface 字段被继续回写。
    productivityTools: updates.productivityTools === undefined
      ? normalizeProductivityToolsSettings(current.productivityTools)
      : normalizeProductivityToolsSettings({ ...current.productivityTools, ...updates.productivityTools }),
  }
  const filePath = getSettingsPath()

  try {
    // 原子写：先写临时文件再 rename，避免写入中途崩溃/断电导致 settings.json 半写损坏。
    const tmpPath = `${filePath}.tmp-${process.pid}`
    writeFileSync(tmpPath, JSON.stringify(updated, null, 2), 'utf-8')
    renameSync(tmpPath, filePath)
    console.log('[设置] 已更新 keys:', Object.keys(updates).join(', '))
  } catch (error) {
    console.error('[设置] 写入失败:', error)
    throw new Error('写入应用设置失败')
  }

  return updated
}

/**
 * 更新应用设置（异步版本，并发安全）。
 *
 * 读-合并-写整体放入模块级串行队列（链式 then），保证并发的
 * updateSettingsAsync 调用严格按调用顺序执行，不会因交错读写丢更新。
 */
export function updateSettingsAsync(updates: Partial<AppSettings>): Promise<AppSettings> {
  const run = settingsWriteQueue.then(() => updateSettings(updates))
  // 队列吞掉失败，避免一次失败阻断后续写入；错误通过返回的 Promise 抛给调用方。
  settingsWriteQueue = run.catch(() => undefined)
  return run
}
