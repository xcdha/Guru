/**
 * app-settings-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「应用设置相关」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { refreshCodeClawConfiguration } from '../lib/codeclaw-service'
import { syncFeishuSyncSleepBlocker } from '../lib/feishu-sleep-blocker'
import { applyIconForCurrentTheme } from '../lib/icon-applier'
import { getSettings, updateSettings, updateSettingsAsync } from '../lib/settings-service'
import { SETTINGS_IPC_CHANNELS } from '../../types'
import type { AppSettings } from '../../types'
import { BrowserWindow, ipcMain, nativeTheme } from 'electron'

export function registerAppSettingsHandlers(): void {
  // ===== 应用设置相关 =====

  // 获取应用设置
  ipcMain.handle(
    SETTINGS_IPC_CHANNELS.GET,
    async (): Promise<AppSettings> => {
      return getSettings()
    }
  )

  // 更新应用设置
  ipcMain.handle(
    SETTINGS_IPC_CHANNELS.UPDATE,
    async (event, updates: Partial<AppSettings>): Promise<AppSettings> => {
      const result = await updateSettingsAsync(updates)

      // 通用设置变更广播：让渲染层实时同步（如 showDelegationUi 开关）
      if (updates.showDelegationUi !== undefined || updates.autoRevealAgentTerminal !== undefined) {
        BrowserWindow.getAllWindows().forEach((win) => {
          if (win.webContents.id !== event.sender.id) {
            win.webContents.send(SETTINGS_IPC_CHANNELS.ON_SETTINGS_CHANGED, {
              showDelegationUi: result.showDelegationUi,
              autoRevealAgentTerminal: result.autoRevealAgentTerminal,
            })
          }
        })
      }

      if (updates.feishuSessionMirror !== undefined) {
        syncFeishuSyncSleepBlocker(result)
      }
      if (updates.codeClaw !== undefined) {
        refreshCodeClawConfiguration()
      }

      // 主题相关设置变化时，广播给所有窗口（跨窗口同步，如 Quick Task 面板）
      if (updates.themeMode !== undefined || updates.themeStyle !== undefined || updates.themePacks !== undefined || updates.themeActiveVariant !== undefined || updates.interfaceVariant !== undefined) {
        const payload = {
          themeMode: result.themeMode,
          themeStyle: result.themeStyle,
          themePacks: result.themePacks,
          themeActiveVariant: result.themeActiveVariant,
          interfaceVariant: result.interfaceVariant,
        }
        BrowserWindow.getAllWindows().forEach((win) => {
          // 跳过发起者窗口，避免重复应用
          if (win.webContents.id !== event.sender.id) {
            win.webContents.send(SETTINGS_IPC_CHANNELS.ON_THEME_SETTINGS_CHANGED, payload)
          }
        })
      }

      // 主题/图标皮肤变化时，刷新 macOS Dock + Windows 托盘图标
      if (updates.themeMode !== undefined || updates.themeStyle !== undefined || updates.themeActiveVariant !== undefined || updates.iconSkin !== undefined) {
        applyIconForCurrentTheme()
      }

      return result
    }
  )

  // 同步更新应用设置（用于 beforeunload 场景）
  ipcMain.on(
    SETTINGS_IPC_CHANNELS.UPDATE_SYNC,
    (event, updates: Partial<AppSettings>) => {
      try {
        const result = updateSettings(updates)
        if (updates.feishuSessionMirror !== undefined) {
          syncFeishuSyncSleepBlocker(result)
        }
        if (updates.codeClaw !== undefined) {
          refreshCodeClawConfiguration()
        }
        event.returnValue = true
      } catch {
        event.returnValue = false
      }
    }
  )

  // 获取系统主题（是否深色模式）
  ipcMain.handle(
    SETTINGS_IPC_CHANNELS.GET_SYSTEM_THEME,
    async (): Promise<boolean> => {
      return nativeTheme.shouldUseDarkColors
    }
  )

  // 监听系统主题变化，推送给所有渲染进程窗口
  nativeTheme.on('updated', () => {
    const isDark = nativeTheme.shouldUseDarkColors
    console.log(`[设置] 系统主题变化: ${isDark ? '深色' : '浅色'}`)
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(SETTINGS_IPC_CHANNELS.ON_SYSTEM_THEME_CHANGED, isDark)
    })
    // system 模式 + auto 图标皮肤需要跟随系统深浅刷新图标
    applyIconForCurrentTheme()
  })
}
