/**
 * 应用设置服务
 *
 * 管理应用设置（主题模式等）的读写。
 * 存储在 ~/.guru/settings.json
 */

import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { getSettingsPath } from './config-paths'
import { DEFAULT_AGENT_RUNTIME, DEFAULT_ICON_SKIN, DEFAULT_INTERFACE_VARIANT, DEFAULT_THEME_MODE } from '../../types'
import type { AppSettings } from '../../types'

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
    }
  }

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw) as Partial<AppSettings> & {
      experimentalAgentRuntimeSwitchEnabled?: boolean
      /** Claude 时代遗留：渠道白名单已随 Pi-only 终态退役 */
      agentChannelIds?: string[]
    }
    // Pi runtime 已默认可用；读取时清理旧版本遗留的实验开关与 Claude 渠道白名单。
    const {
      experimentalAgentRuntimeSwitchEnabled: _legacyRuntimeSwitch,
      agentChannelIds: _legacyAgentChannelIds,
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
      builtinMcpDisabledIds: settings.builtinMcpDisabledIds ?? [],
      sidebarModuleCollapsed: data.sidebarModuleCollapsed ?? {},
      agentRuntime: settings.agentRuntime ?? DEFAULT_AGENT_RUNTIME,
      windowsShellPreference: settings.windowsShellPreference ?? 'auto',
      agentThinking: settings.agentThinking ?? { type: 'adaptive' },
      defaultThinkingLevel: settings.defaultThinkingLevel ?? 'high',
      // 缺省 true：老配置文件未写该字段时保持推广默认开启
      gitAttributionEnabled: settings.gitAttributionEnabled ?? true,
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
    }
  }
}

/**
 * 更新应用设置
 *
 * 合并更新字段并写入文件。
 */
export function updateSettings(updates: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const updated: AppSettings = {
    ...current,
    ...updates,
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
