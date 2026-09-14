/**
 * workspace-memory-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「工作区记忆文件管理」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 * 同时迁入仅被该组使用的辅助声明: stopWorkspaceMemoryWatch, workspaceMemoryWatchDestroyedListeners, workspaceMemoryWatchSubscriptions
 */

import { spawnExpertCowork } from '../lib/agent-cowork'
import { reserveAgentSessionStart, runAgent, setVisibleAgentSession, stopAgent } from '../lib/agent-service'
import { getAgentSessionMeta } from '../lib/agent-session-manager'
import { approveWorkspaceProjectKnowledgeMaintenance, getWorkspaceMemorySummary, listWorkspaceAutoMemoryFiles, readWorkspaceAgentsMd, readWorkspaceAutoMemoryFile, writeWorkspaceAgentsMd, writeWorkspaceAutoMemoryFile } from '../lib/agent-workspace-manager'
import { feishuBridgeManager } from '../lib/feishu-bridge-manager'
import { subscribeWorkspaceMemoryChanges } from '../lib/workspace-memory-change-watcher'
import { confirmWorkspaceMemoryWindowClose, markWorkspaceMemoryWindowReady } from '../lib/workspace-memory-window'
import { AGENT_IPC_CHANNELS } from '@guru/shared'
import type { AgentSendInput, SkillFileContent, WorkspaceMemorySummary } from '@guru/shared'
import { ipcMain } from 'electron'

function stopWorkspaceMemoryWatch(webContentsId: number, workspaceSlug: string): void {
  const subscriptions = workspaceMemoryWatchSubscriptions.get(webContentsId)
  const unsubscribe = subscriptions?.get(workspaceSlug)
  if (!unsubscribe) return
  unsubscribe()
  subscriptions?.delete(workspaceSlug)
  if (subscriptions?.size === 0) workspaceMemoryWatchSubscriptions.delete(webContentsId)
}
const workspaceMemoryWatchDestroyedListeners = new Set<number>()
/** 按渲染进程隔离的订阅表；在显式 STOP 或 renderer 销毁时释放。 */
const workspaceMemoryWatchSubscriptions = new Map<number, Map<string, () => void>>()

export function registerWorkspaceMemoryHandlers(): void {
  // ===== 工作区记忆文件管理 =====

  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_WORKSPACE_MEMORY_SUMMARY,
    async (_, workspaceSlug: string): Promise<WorkspaceMemorySummary> => {
      return getWorkspaceMemorySummary(workspaceSlug)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.READ_WORKSPACE_AGENTS_MD,
    async (_, workspaceSlug: string): Promise<SkillFileContent> => {
      return readWorkspaceAgentsMd(workspaceSlug)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.WRITE_WORKSPACE_AGENTS_MD,
    async (_, workspaceSlug: string, content: string, expectedContent?: string): Promise<void> => {
      writeWorkspaceAgentsMd(workspaceSlug, content, expectedContent)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_WORKSPACE_AUTO_MEMORY_FILES,
    async (_, workspaceSlug: string) => {
      return listWorkspaceAutoMemoryFiles(workspaceSlug)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.READ_WORKSPACE_AUTO_MEMORY_FILE,
    async (_, workspaceSlug: string, relativePath: string): Promise<SkillFileContent> => {
      return readWorkspaceAutoMemoryFile(workspaceSlug, relativePath)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.WRITE_WORKSPACE_AUTO_MEMORY_FILE,
    async (_, workspaceSlug: string, relativePath: string, content: string, expectedContent?: string): Promise<void> => {
      writeWorkspaceAutoMemoryFile(workspaceSlug, relativePath, content, expectedContent)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.APPROVE_WORKSPACE_PROJECT_KNOWLEDGE_MAINTENANCE,
    async (_, workspaceSlug: string): Promise<void> => {
      approveWorkspaceProjectKnowledgeMaintenance(workspaceSlug)
    }
  )

  ipcMain.handle(AGENT_IPC_CHANNELS.OPEN_WORKSPACE_MEMORY_WINDOW, async (_, workspaceSlug: string, relativePath?: string): Promise<void> => {
    // 先经既有受限访问层核验 slug；若指定文件，也用受限路径解析器验证。
    getWorkspaceMemorySummary(workspaceSlug)
    if (relativePath !== undefined) {
      if (typeof relativePath !== 'string' || !relativePath) throw new Error('记忆文件路径非法')
      readWorkspaceAutoMemoryFile(workspaceSlug, relativePath)
    }
    const { showWorkspaceMemoryWindow } = await import('../lib/workspace-memory-window')
    showWorkspaceMemoryWindow(workspaceSlug, relativePath)
  })

  ipcMain.handle(
    AGENT_IPC_CHANNELS.WORKSPACE_MEMORY_WINDOW_READY,
    async (event, workspaceSlug: string): Promise<void> => {
      if (!markWorkspaceMemoryWindowReady(workspaceSlug, event.sender.id)) {
        throw new Error('记忆窗口不存在或不属于当前渲染进程')
      }
    },
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.CONFIRM_WORKSPACE_MEMORY_WINDOW_CLOSE,
    async (event, workspaceSlug: string): Promise<void> => {
      if (!confirmWorkspaceMemoryWindowClose(workspaceSlug, event.sender.id)) {
        throw new Error('记忆窗口不存在或不属于当前渲染进程')
      }
    },
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.START_WORKSPACE_MEMORY_WATCH,
    async (event, workspaceSlug: string): Promise<void> => {
      const webContents = event.sender
      stopWorkspaceMemoryWatch(webContents.id, workspaceSlug)
      const unsubscribe = subscribeWorkspaceMemoryChanges(workspaceSlug, (change) => {
        if (!webContents.isDestroyed()) {
          webContents.send(AGENT_IPC_CHANNELS.WORKSPACE_MEMORY_FILE_CHANGED, { workspaceSlug, change })
        }
      })
      const subscriptions = workspaceMemoryWatchSubscriptions.get(webContents.id) ?? new Map<string, () => void>()
      subscriptions.set(workspaceSlug, unsubscribe)
      workspaceMemoryWatchSubscriptions.set(webContents.id, subscriptions)
      if (!workspaceMemoryWatchDestroyedListeners.has(webContents.id)) {
        workspaceMemoryWatchDestroyedListeners.add(webContents.id)
        webContents.once('destroyed', () => {
          const active = workspaceMemoryWatchSubscriptions.get(webContents.id)
          if (active) {
            for (const stop of active.values()) stop()
            workspaceMemoryWatchSubscriptions.delete(webContents.id)
          }
          workspaceMemoryWatchDestroyedListeners.delete(webContents.id)
        })
      }
    },
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.STOP_WORKSPACE_MEMORY_WATCH,
    async (event, workspaceSlug: string): Promise<void> => {
      stopWorkspaceMemoryWatch(event.sender.id, workspaceSlug)
    },
  )

  // 发送 Agent 消息（触发 Agent SDK 流式响应）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SEND_MESSAGE,
    async (event, input: AgentSendInput): Promise<void> => {
      const releaseStart = reserveAgentSessionStart(input.sessionId)
      try {
        const session = getAgentSessionMeta(input.sessionId)
        if (session) {
          await feishuBridgeManager.startSessionMirrorRun(session).catch((error) => {
            console.error('[飞书 Session 镜像] 流式卡片初始化失败:', error)
          })
        }
        await runAgent(input, event.sender)
      } finally {
        releaseStart()
      }
    }
  )

  // renderer 的当前 Agent Tab 决定 partial 消息是前台 20fps 还是后台 4fps。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SET_VISIBLE_STREAM_SESSION,
    async (event, sessionId: string | null): Promise<void> => {
      if (sessionId !== null && (typeof sessionId !== 'string' || sessionId.length === 0)) {
        throw new Error('可见 Agent 会话 ID 非法')
      }
      setVisibleAgentSession(event.sender, sessionId)
    },
  )

  // 中止 Agent 执行
  ipcMain.handle(
    AGENT_IPC_CHANNELS.STOP_AGENT,
    async (_, sessionId: string): Promise<void> => {
      feishuBridgeManager.stopSessionMirrorRun(sessionId)
      stopAgent(sessionId)
    }
  )

  // 会话级拉专家/专家团 cowork（创建注入专家人设的子会话）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SPAWN_EXPERT_COWORK,
    async (
      _,
      input: import('@guru/shared').SpawnExpertCoworkInput,
    ): Promise<import('@guru/shared').SpawnExpertCoworkResult> => {
      if (!input || typeof input !== 'object') throw new Error('input 必须是对象')
      if (typeof input.parentSessionId !== 'string' || input.parentSessionId.length === 0) {
        throw new Error('parentSessionId 必填')
      }
      if (typeof input.expertId === 'string' && typeof input.teamId === 'string') {
        throw new Error('expertId 与 teamId 不能同时指定')
      }
      return spawnExpertCowork(input.parentSessionId, input)
    }
  )
}
