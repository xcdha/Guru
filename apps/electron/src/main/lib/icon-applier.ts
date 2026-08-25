/**
 * 主进程图标皮肤统一应用器。
 *
 * 根据当前设置（themeMode/themeStyle/themeActiveVariant/iconSkin）解析实际深浅，
 * 然后刷新 macOS Dock 图标 + Windows 托盘图标。在应用启动、主题设置变更、
 * 系统主题变化时调用，保证图标与界面主题一致。
 */

import { app, nativeTheme, BrowserWindow, nativeImage } from 'electron'
import { getSettings } from './settings-service'
import { getDockIconPath, getWindowIconPath, getWinTrayIconPath, resolveIconSkinVariant } from './icon-theme'
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

  // Windows 窗口 / 任务栏 / Alt-Tab 图标（可动态换）
  if (process.platform === 'win32') {
    try {
      const iconPath = getWinTrayIconPath(variant)
      const image = nativeImage.createFromPath(iconPath)
      if (!image.isEmpty()) {
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) {
            win.setIcon(image)
          }
        })
        console.log('[图标] 窗口/任务栏图标已切换:', variant)
      } else {
        console.warn('[图标] 窗口图标为空，跳过:', iconPath)
      }
    } catch (error) {
      console.error('[图标] 窗口/任务栏图标切换失败:', error)
    }
  }

  // Windows 托盘图标（macOS 托盘用 Template 自动适配，无需切）
  updateTrayIcon(variant)
}
