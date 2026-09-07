/**
 * 窗口页面缩放统一工具
 *
 * 收敛所有缩放路径（快捷键 Ctrl+=/Ctrl+-/Ctrl+0、菜单缩放、滚轮缩放 IPC），
 * 统一按 zoomFactor 的 ±5% 步进（Electron zoomLevel 语义不直观：每级 20%，
 * 无法表达 95%/105% 这类 5% 粒度；zoomFactor 才是线性百分比）。
 *
 * 每次缩放后都向 renderer 广播 WINDOW_ZOOM_FACTOR_CHANGED，供 BrowserPanel
 * 换算内嵌浏览器边界，以及缩放百分比指示器显示当前值。
 */

import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@guru/shared'

/** 单步缩放比例：×1.05（放大）/ ÷1.05（缩小），即 5% 步进 */
const ZOOM_STEP_FACTOR = 1.05
/** 缩放范围：最小 50%，最大 200% */
const ZOOM_MIN_FACTOR = 0.5
const ZOOM_MAX_FACTOR = 2.0
/** 默认缩放 100% */
const ZOOM_DEFAULT_FACTOR = 1.0

function roundFactor(value: number): number {
  // 5% 粒度取整到 0.05（避免浮点累计误差，如 1.05 * 0.95 → 0.9975）
  return Math.round(value * 20) / 20
}

function broadcastZoomFactor(win: BrowserWindow, factor: number): void {
  if (win.isDestroyed()) return
  win.webContents.send(IPC_CHANNELS.WINDOW_ZOOM_FACTOR_CHANGED, factor)
}

/** 放大一档（zoomFactor × 1.05，上限 200%） */
export function applyWindowZoomIn(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const next = Math.min(roundFactor(win.webContents.getZoomFactor() * ZOOM_STEP_FACTOR), ZOOM_MAX_FACTOR)
  win.webContents.setZoomFactor(next)
  broadcastZoomFactor(win, next)
}

/** 缩小一档（zoomFactor ÷ 1.05，下限 50%） */
export function applyWindowZoomOut(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const next = Math.max(roundFactor(win.webContents.getZoomFactor() / ZOOM_STEP_FACTOR), ZOOM_MIN_FACTOR)
  win.webContents.setZoomFactor(next)
  broadcastZoomFactor(win, next)
}

/** 重置缩放（100%） */
export function resetWindowZoom(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.webContents.setZoomFactor(ZOOM_DEFAULT_FACTOR)
  broadcastZoomFactor(win, ZOOM_DEFAULT_FACTOR)
}

/** 当前缩放因子（1 = 100%） */
export function getWindowZoomFactor(win: BrowserWindow): number {
  if (win.isDestroyed()) return ZOOM_DEFAULT_FACTOR
  return win.webContents.getZoomFactor()
}
