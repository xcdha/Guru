/**
 * window-control-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「窗口控制」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { IPC_CHANNELS } from '@guru/shared'
import { BrowserWindow, ipcMain } from 'electron'

export function registerWindowControlHandlers(): void {
  // ===== 窗口控制（Windows 自定义标题栏按钮）=====

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_MINIMIZE,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) win.minimize()
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_MAXIMIZE,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        win.isMaximized() ? win.unmaximize() : win.maximize()
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_CLOSE,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) win.close()
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_IS_MAXIMIZED,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return win && !win.isDestroyed() ? win.isMaximized() : false
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_IS_FULLSCREEN,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return win && !win.isDestroyed() ? win.isFullScreen() : false
    }
  )
}
