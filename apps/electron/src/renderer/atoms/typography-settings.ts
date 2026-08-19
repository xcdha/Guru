/**
 * 正文字排版设置原子
 *
 * 提供 AI 回复与 Markdown 编辑器的精细排版调节：字号、行距、字距、文字颜色。
 * 与 MarkdownFontSize（三档快捷切换）并存：档位控制 --md-preview-font-size，
 * 此处通过 --md-body-font-size / --md-body-line-height / --md-body-letter-spacing /
 * --md-body-color 四个 CSS 变量驱动。
 *
 * fontSize 语义：undefined = 跟随 MarkdownFontSize 档位（applyTypographyToDOM
 * 不写 --md-body-font-size，由 markdown-font-size.ts 的档位逻辑负责）；显式赋值
 * 则精细覆盖档位。
 * 持久化到 ~/.myyoda/settings.json（字段 settings.typography）。
 */

import { atom, getDefaultStore } from 'jotai'
import { DEFAULT_TYPOGRAPHY_SETTINGS } from '../../types'
import type { TypographySettings } from '../../types'

/** 排版状态原子（渲染进程内存态，初始化时从主进程加载） */
export const typographySettingsAtom = atom<TypographySettings>(DEFAULT_TYPOGRAPHY_SETTINGS)

/** 各精细值的应用范围（px / 倍率 / px / px / 颜色值） */
export const TYPOGRAPHY_LIMITS = {
  fontSize: { min: 12, max: 24 },
  lineHeight: { min: 1.2, max: 2.4 },
  letterSpacing: { min: -1, max: 2 },
  paragraphSpacing: { min: 0, max: 24 },
} as const

/** 读取当前排版设置（含未显式设置字段的默认值合并） */
export function getCurrentTypography(): TypographySettings {
  return { ...DEFAULT_TYPOGRAPHY_SETTINGS, ...getDefaultStore().get(typographySettingsAtom) }
}

/**
 * 将排版设置写入 :root CSS 变量（渲染组件通过 var() 读取）。
 * fontSize 为 undefined 时不移除 --md-body-font-size（交给档位逻辑管理）。
 */
export function applyTypographyToDOM(settings: TypographySettings): void {
  const root = document.documentElement.style
  if (settings.fontSize != null) {
    root.setProperty('--md-body-font-size', `${settings.fontSize}px`)
  }
  if (settings.lineHeight != null) {
    root.setProperty('--md-body-line-height', `${settings.lineHeight}`)
  }
  if (settings.letterSpacing != null) {
    root.setProperty('--md-body-letter-spacing', `${settings.letterSpacing}px`)
  }
  if (settings.paragraphSpacing != null) {
    root.setProperty('--md-body-paragraph-spacing', `${settings.paragraphSpacing}px`)
  } else {
    root.removeProperty('--md-body-paragraph-spacing')
  }
  if (settings.textColor) {
    root.setProperty('--md-body-color', settings.textColor)
  } else {
    root.removeProperty('--md-body-color')
  }
}

/** 从主进程加载排版设置并应用 */
export async function initializeTypographySettings(setSettings: (s: TypographySettings) => void): Promise<void> {
  try {
    const settings = await window.electronAPI.getSettings()
    const typography: TypographySettings = { ...DEFAULT_TYPOGRAPHY_SETTINGS, ...(settings.typography ?? {}) }
    setSettings(typography)
    applyTypographyToDOM(typography)
  } catch (error) {
    console.error('[排版] 初始化失败:', error)
    applyTypographyToDOM(DEFAULT_TYPOGRAPHY_SETTINGS)
  }
}

/**
 * 更新排版设置并持久化（部分更新：未传字段保留当前值）。
 * 调用方无需传完整对象；底层从 atom 当前值合并，避免丢字段。
 */
export async function updateTypographySettings(partial: Partial<TypographySettings>): Promise<TypographySettings> {
  const merged = { ...getCurrentTypography(), ...partial }
  applyTypographyToDOM(merged)
  getDefaultStore().set(typographySettingsAtom, merged)
  try {
    await window.electronAPI.updateSettings({ typography: merged })
  } catch (error) {
    console.error('[排版] 保存失败:', error)
  }
  return merged
}
