/**
 * 区域样式设置原子
 *
 * 按区域（界面文字 / 对话正文 / 输入框 / 代码块）自定义字体大小与颜色，
 * 通过 CSS 变量驱动（--area-{area}-font-size / --area-{area}-color），
 * 即时生效并持久化到 settings.json（字段 settings.areaStyles）。
 *
 * 渲染组件消费方式：在区域根节点 class 上加 `text-[length:var(--area-xxx-font-size)]`
 * 与 `text-[color:var(--area-xxx-color)]`；变量未设置时回落主题默认。
 */

import { atom, getDefaultStore } from 'jotai'
import { DEFAULT_AREA_STYLES, AREA_CSS_VARIABLES } from '../../types'
import type { AreaStyleMap, StyleAreaId } from '../../types'

/** 区域样式状态原子 */
export const areaStylesAtom = atom<AreaStyleMap>(DEFAULT_AREA_STYLES)

/** 读取当前区域样式 */
export function getCurrentAreaStyles(): AreaStyleMap {
  return { ...DEFAULT_AREA_STYLES, ...getDefaultStore().get(areaStylesAtom) }
}

/** 界面文字颜色：仅当用户显式设置颜色时激活 .app-ui-area 内的颜色覆盖规则，
 * 避免未设置时 color: var(--area-ui-color) 回落为 inherit 破坏主题色。
 * App 可能因启动加载屏/Onboarding 延迟挂载 .app-ui-area，这里在 DOM 就绪后
 * 重试一次，并用 MutationObserver 兜底（主界面最终出现时再补一次）。 */
let uiColorClassApplied = false
function applyUiColorCustomClass(styles: AreaStyleMap): void {
  const uiColor = styles.ui?.color
  const areaEl = document.querySelector('.app-ui-area')
  if (areaEl) {
    areaEl.classList.toggle('ui-color-custom', Boolean(uiColor))
    uiColorClassApplied = true
    return
  }
  // 容器尚未挂载（启动加载屏 / Onboarding）：挂一个一次性 MutationObserver，
  // 主界面出现时立即补设置，避免用户已保存的界面颜色在重启后丢失。
  if (uiColorClassApplied) return
  const observer = new MutationObserver(() => {
    const el = document.querySelector('.app-ui-area')
    if (!el) return
    el.classList.toggle('ui-color-custom', Boolean(uiColor))
    uiColorClassApplied = true
    observer.disconnect()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  // 兜底：1.5s 后仍未挂载则放弃观察，避免长期占用。
  setTimeout(() => observer.disconnect(), 1500)
}

/** 将区域样式写入 :root CSS 变量 */
export function applyAreaStylesToDOM(styles: AreaStyleMap): void {
  const root = document.documentElement.style
  for (const area of Object.keys(AREA_CSS_VARIABLES) as StyleAreaId[]) {
    const vars = AREA_CSS_VARIABLES[area]
    const style = styles[area]
    if (style?.fontSize != null) {
      root.setProperty(vars.fontSize, `${style.fontSize}px`)
    } else {
      root.removeProperty(vars.fontSize)
    }
    if (style?.color) {
      root.setProperty(vars.color, style.color)
    } else {
      root.removeProperty(vars.color)
    }
  }
  applyUiColorCustomClass(styles)
}

/** 从主进程加载区域样式并应用 */
export async function initializeAreaStyles(setStyles: (s: AreaStyleMap) => void): Promise<void> {
  try {
    const settings = await window.electronAPI.getSettings()
    const styles: AreaStyleMap = { ...DEFAULT_AREA_STYLES, ...(settings.areaStyles ?? {}) }
    setStyles(styles)
    applyAreaStylesToDOM(styles)
  } catch (error) {
    console.error('[区域样式] 初始化失败:', error)
    applyAreaStylesToDOM(DEFAULT_AREA_STYLES)
  }
}

/** 更新单个区域的样式并持久化（部分更新：未传字段保留该区域当前值） */
export async function updateAreaStyle(
  area: StyleAreaId,
  partial: { fontSize?: number; color?: string },
): Promise<AreaStyleMap> {
  const current = getCurrentAreaStyles()
  const next: AreaStyleMap = {
    ...current,
    [area]: { ...(current[area] ?? {}), ...partial },
  }
  applyAreaStylesToDOM(next)
  getDefaultStore().set(areaStylesAtom, next)
  try {
    await window.electronAPI.updateSettings({ areaStyles: next })
  } catch (error) {
    console.error('[区域样式] 保存失败:', error)
  }
  return next
}

/** 重置单个区域为跟随主题 */
export async function resetAreaStyle(area: StyleAreaId): Promise<AreaStyleMap> {
  return updateAreaStyle(area, { fontSize: undefined, color: undefined })
}
