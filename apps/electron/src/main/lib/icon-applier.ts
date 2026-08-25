/**
 * 主进程图标皮肤统一应用器。
 *
 * 根据当前设置（themeMode/themeStyle/themeActiveVariant/iconSkin）解析实际深浅，
 * 然后刷新 macOS Dock 图标 + Windows 托盘图标。在应用启动、主题设置变更、
 * 系统主题变化时调用，保证图标与界面主题一致。
 */

import { app, nativeTheme } from 'electron'
import { getSettings } from './settings-service'
import { getDockIconPath, getWindowIconPath, resolveIconSkinVariant } from './icon-theme'
import { updateTrayIcon } from '../tray'

/** 主窗口创建时使用的图标路径（按当前图标皮肤变体） */
export function getCurrentWindowIconPath(): string {
  const s = getSettings()
  const variant = resolveIconSkinVariant(s.iconSkin ?? 'auto', {
    themeMode: s.themeMode,
    themeStyle: s.themeStyle,
    themeActiveVariant: s.themeActiveVariant,
    systemIsDark: nativeTheme.shouldUseDarkColors,
  })
  return getWindowIconPath(variant)
}

/**
 * 重新应用当前图标皮肤（Dock + 托盘）。
 * 由启动、主题变更、系统主题变化时调用。
 */
export function applyIconForCurrentTheme(): void {
  const s = getSettings()
  const variant = resolveIconSkinVariant(s.iconSkin ?? 'auto', {
    themeMode: s.themeMode,
    themeStyle: s.themeStyle,
    themeActiveVariant: s.themeActiveVariant,
    systemIsDark: nativeTheme.shouldUseDarkColors,
  })

  // macOS Dock 图标（可动态换）
  if (app.isReady()) {
    try {
      if (process.platform === 'darwin' && app.dock) {
        const iconPath = getDockIconPath(variant)
        app.dock.setIcon(iconPath)
        console.log('[图标] Dock 图标已切换到:', variant)
      }
    } catch (error) {
      console.error('[图标] Dock 图标切换失败:', error)
    }
  }

  // Windows 托盘图标（macOS 托盘用 Template 自动适配，无需切）
  updateTrayIcon(variant)
}
