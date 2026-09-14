/**
 * repo-map-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「代码图谱工具」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { repoMapToolsService } from '../lib/repo-map-tools-service'
import { AGENT_IPC_CHANNELS } from '@guru/shared'
import { BrowserWindow, ipcMain } from 'electron'

export function registerRepoMapHandlers(): void {
  // ===== 代码图谱工具（repo map + Graphify，2026-08-13） =====

  // 查询图谱工具状态（纯读，无副作用）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.REPO_MAP_TOOLS_GET_STATE,
    (_event, cwd: string) => repoMapToolsService.getState(cwd)
  )

  // 幂等创建（对话栏按钮唯一主动入口；构建异步完成，经 STATUS 推送）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.REPO_MAP_TOOLS_ENSURE,
    (_event, cwd: string, forceUpdate?: boolean) => repoMapToolsService.ensureMapTools(cwd, { forceUpdate: forceUpdate === true })
  )

  // 一键安装 graphify（进度经 INSTALL_PROGRESS 推送）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.REPO_MAP_TOOLS_INSTALL,
    (event) => repoMapToolsService.installGraphify((line) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(AGENT_IPC_CHANNELS.REPO_MAP_TOOLS_INSTALL_PROGRESS, line)
      }
    })
  )

  // 卸载 graphify
  ipcMain.handle(
    AGENT_IPC_CHANNELS.REPO_MAP_TOOLS_UNINSTALL,
    (event) => repoMapToolsService.uninstallGraphify((line) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(AGENT_IPC_CHANNELS.REPO_MAP_TOOLS_INSTALL_PROGRESS, line)
      }
    })
  )

  // 状态变更推送（服务事件 → 所有窗口广播，渲染进程不轮询）
  repoMapToolsService.onStateChange((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(AGENT_IPC_CHANNELS.REPO_MAP_TOOLS_STATUS, state)
      }
    }
  })
}
