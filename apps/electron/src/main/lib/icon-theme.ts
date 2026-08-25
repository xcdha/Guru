/**
 * 图标皮肤解析（主进程）
 *
 * 决定当前应使用深底图标（icon.*）还是浅底图标（icon-light.*）。
 * deep = 深底深色图标（Guru 默认），light = 浅底浅色图标。
 * 复刻 renderer/theme/theme.logic.ts 的 resolvedThemeAtom 逻辑，确保主进程
 * 与界面实际深浅一致，而不是只用 themeMode 简单判断（special/custom 需额外分歧）。
 */

import { app } from 'electron'
import { join } from 'path'
import type { IconSkin, ThemeMode, ThemeStyle, ThemeVariant } from '../../types'

/** 解析出的图标皮肤变体 */
export type IconSkinVariant = 'dark' | 'light'

export interface IconThemeContext {
  themeMode: ThemeMode
  themeStyle?: ThemeStyle
  themeActiveVariant?: ThemeVariant
  systemIsDark: boolean
}

/**
 * 解析当前应使用的图标皮肤变体。
 * - iconSkin='light' → 强制浅底
 * - iconSkin='dark'  → 强制深底
 * - iconSkin='auto'  → 跟随主题实际深浅（与 resolvedThemeAtom 一致）
 */
export function resolveIconSkinVariant(
  iconSkin: IconSkin,
  ctx: IconThemeContext,
): IconSkinVariant {
  if (iconSkin === 'light') return 'light'
  if (iconSkin === 'dark') return 'dark'

  const { themeMode, themeStyle, themeActiveVariant, systemIsDark } = ctx

  if (themeMode === 'system') return systemIsDark ? 'dark' : 'light'
  if (themeMode === 'special') {
    if (themeStyle === 'custom') {
      return themeActiveVariant === 'light' ? 'light' : 'dark'
    }
    return themeStyle && themeStyle.endsWith('-light') ? 'light' : 'dark'
  }
  // 'light' | 'dark'
  return themeMode === 'dark' ? 'dark' : 'light'
}

/** 返回当前变体对应的亮色/深色图标根路径 */
function iconRoot(): string {
  // dev: __dirname/resources（build:resources 拷贝产物）
  // prod: process.resourcesPath（electron-builder extraResources 产物）
  return app.isPackaged
    ? process.resourcesPath
    : join(__dirname, 'resources')
}

/**
 * 获取 macOS Dock 图标路径（.icns）。
 */
export function getDockIconPath(variant: IconSkinVariant): string {
  const file = variant === 'light' ? 'icon-light.icns' : 'icon.icns'
  return join(iconRoot(), file)
}

/**
 * 获取 Windows 托盘用彩色图标路径（.png）。
 * 注：macOS 托盘用 Template 单色图标（系统自动适配深浅），不随图标皮肤切换。
 */
export function getWinTrayIconPath(variant: IconSkinVariant): string {
  const file = variant === 'light' ? 'icon-light.png' : 'icon.png'
  return join(iconRoot(), file)
}

/**
 * 获取窗口/Win 任务栏图标路径（创建 BrowserWindow 用）。
 * 注意：Windows 任务栏/Alt-Tab 图标编译进 exe，运行时不可换；此为窗口 icon 用。
 */
export function getWindowIconPath(variant: IconSkinVariant): string {
  const file =
    variant === 'light'
      ? process.platform === 'win32'
        ? 'icon-light.ico'
        : 'icon-light.png'
      : process.platform === 'darwin'
        ? 'icon.icns'
        : process.platform === 'win32'
          ? 'icon.ico'
          : 'icon.png'
  return join(iconRoot(), file)
}
