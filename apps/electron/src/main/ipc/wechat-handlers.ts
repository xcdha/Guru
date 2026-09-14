/**
 * wechat-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「微信集成」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { autoArchiveAgentSessions, cleanupStaleAttachedPaths } from '../lib/agent-session-manager'
import { cleanupStaleWorkspaceAttachedPaths } from '../lib/agent-workspace-manager'
import { autoArchiveConversations } from '../lib/conversation-manager'
import { getSettings } from '../lib/settings-service'
import { registerUpdaterIpc } from '../lib/updater/updater-ipc'
import { wechatBridge } from '../lib/wechat-bridge'
import { getWeChatConfig } from '../lib/wechat-config'
import { WECHAT_IPC_CHANNELS } from '@guru/shared'
import type { WeChatBridgeState, WeChatConfig } from '@guru/shared'
import { ipcMain } from 'electron'

export function registerWechatHandlers(): void {
  // ===== 微信集成 =====

  // 获取微信配置
  ipcMain.handle(
    WECHAT_IPC_CHANNELS.GET_CONFIG,
    async (): Promise<WeChatConfig> => {
      return getWeChatConfig()
    }
  )

  // 开始扫码登录
  ipcMain.handle(
    WECHAT_IPC_CHANNELS.START_LOGIN,
    async (): Promise<void> => {
      await wechatBridge.startLogin()
    }
  )

  // 登出
  ipcMain.handle(
    WECHAT_IPC_CHANNELS.LOGOUT,
    async (): Promise<void> => {
      wechatBridge.logout()
    }
  )

  // 启动 Bridge（用已有凭证）
  ipcMain.handle(
    WECHAT_IPC_CHANNELS.START_BRIDGE,
    async (): Promise<void> => {
      await wechatBridge.start()
    }
  )

  // 停止 Bridge
  ipcMain.handle(
    WECHAT_IPC_CHANNELS.STOP_BRIDGE,
    async (): Promise<void> => {
      wechatBridge.stop()
    }
  )

  // 获取 Bridge 状态
  ipcMain.handle(
    WECHAT_IPC_CHANNELS.GET_STATUS,
    async (): Promise<WeChatBridgeState> => {
      return wechatBridge.getStatus()
    }
  )

  console.log('[IPC] IPC 处理器注册完成')

  // 注册更新 IPC 处理器
  registerUpdaterIpc()

  // 启动时自动归档 + 每 24 小时定期检查
  const runAutoArchive = (): void => {
    try {
      const settings = getSettings()
      const days = settings.archiveAfterDays ?? 7
      if (days > 0) {
        const archivedChats = autoArchiveConversations(days)
        const archivedSessions = autoArchiveAgentSessions(days)
        if (archivedChats + archivedSessions > 0) {
          console.log(`[自动归档] 已归档 ${archivedChats} 个对话, ${archivedSessions} 个 Agent 会话`)
        }
      }
    } catch (error) {
      console.error('[自动归档] 自动归档失败:', error)
    }
  }

  runAutoArchive()
  setInterval(runAutoArchive, 24 * 60 * 60 * 1000)

  // 启动时清理不存在的附加目录/文件（如已删除的 worktree）
  try {
    cleanupStaleAttachedPaths()
    cleanupStaleWorkspaceAttachedPaths()
  } catch (error) {
    console.error('[启动清理] 清理失效附加路径失败:', error)
  }
}
