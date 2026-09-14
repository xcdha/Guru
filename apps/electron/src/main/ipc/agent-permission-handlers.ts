/**
 * agent-permission-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「Agent 权限系统」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { resolvePiReasoningCapability } from '../lib/adapters/pi-model-registry'
import { permissionService } from '../lib/agent-permission-service'
import { isAgentSessionActive, updateAgentPermissionMode } from '../lib/agent-service'
import { getAgentSessionMeta, updateAgentSessionMeta } from '../lib/agent-session-manager'
import { getChannelById } from '../lib/channel-manager'
import { AGENT_IPC_CHANNELS, AGENT_THINKING_LEVELS, isGuruPermissionMode } from '@guru/shared'
import type { AgentSessionMeta, AgentThinkingLevel, GuruPermissionMode, PermissionResponse, StopTaskInput } from '@guru/shared'
import { ipcMain, shell } from 'electron'

export function registerAgentPermissionHandlers(): void {
  // ===== Agent 权限系统 =====

  // 响应权限请求
  ipcMain.handle(
    AGENT_IPC_CHANNELS.PERMISSION_RESPOND,
    async (event, response: PermissionResponse): Promise<void> => {
      const { requestId, behavior, alwaysAllow } = response
      const sessionId = permissionService.respondToPermission(requestId, behavior, alwaysAllow)

      // 发送 permission_resolved 事件给渲染进程
      if (sessionId) {
        event.sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
          sessionId,
          payload: { kind: 'guru_event', event: { type: 'permission_resolved', requestId, behavior } },
        })
      }
    }
  )

  // 停止任务
  ipcMain.handle(
    AGENT_IPC_CHANNELS.STOP_TASK,
    async (_, input: StopTaskInput): Promise<void> => {
      try {
        if (input.type === 'shell') {
          console.warn('[IPC] STOP_TASK: Shell 任务停止功能待实现')
        } else {
          console.warn('[IPC] STOP_TASK: Agent 任务暂不支持单独停止')
        }
      } catch (error) {
        console.error('[IPC] 停止任务失败:', error)
        throw error
      }
    }
  )

  // 热切换指定会话的权限模式（运行中生效，不广播）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPDATE_SESSION_PERMISSION_MODE,
    async (_, sessionId: string, mode: GuruPermissionMode): Promise<void> => {
      if (!isGuruPermissionMode(mode)) {
        throw new Error(`无效的权限模式: ${mode}`)
      }
      // 会话不存在时直接抛错（避免 updateAgentSessionMeta 的通用异常被降级为 warn）
      if (!getAgentSessionMeta(sessionId)) {
        throw new Error(`Agent 会话不存在: ${sessionId}`)
      }
      // 持久化到 session meta（重启后可恢复，即使 session 未运行也要写）。
      // 这里的 catch 仅用于兜底磁盘 I/O 类异常，不影响后续热切换。
      try {
        updateAgentSessionMeta(sessionId, { permissionMode: mode })
      } catch (err) {
        console.warn(`[IPC] 持久化 session 权限模式失败: sessionId=${sessionId}`, err)
      }
      // 若 session 正在跑，同步热切换运行时模式
      if (isAgentSessionActive(sessionId)) {
        await updateAgentPermissionMode(sessionId, mode).catch((err) => {
          console.warn(`[IPC] 运行中权限模式切换失败: sessionId=${sessionId}`, err)
          throw err
        })
      }
    }
  )

  // 切换指定会话的 Agent runtime（空闲后下一轮生效）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPDATE_SESSION_CODEX_FAST_MODE,
    async (_, sessionId: string, enabled: boolean): Promise<AgentSessionMeta> => {
      if (typeof enabled !== 'boolean') {
        throw new Error(`无效的 Codex Fast Mode 状态: ${String(enabled)}`)
      }
      if (!getAgentSessionMeta(sessionId)) {
        throw new Error(`Agent 会话不存在: ${sessionId}`)
      }
      if (isAgentSessionActive(sessionId)) {
        throw new Error('Agent 正在运行，完成后再切换快速模式')
      }
      return updateAgentSessionMeta(sessionId, { codexFastMode: enabled })
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_PI_REASONING_CAPABILITY,
    async (_, channelId: string, modelId: string) => {
      if (!channelId || !modelId) return undefined
      const channel = getChannelById(channelId)
      if (!channel) return undefined
      return resolvePiReasoningCapability(channel.provider, modelId)
    },
  )

  const handleSessionReasoningLevelUpdate = async (_: Electron.IpcMainInvokeEvent, sessionId: string, thinkingLevel: AgentThinkingLevel): Promise<AgentSessionMeta> => {
      if (!AGENT_THINKING_LEVELS.includes(thinkingLevel)) {
        throw new Error(`无效的思考深度: ${String(thinkingLevel)}`)
      }
      if (!getAgentSessionMeta(sessionId)) {
        throw new Error(`Agent 会话不存在: ${sessionId}`)
      }
      if (isAgentSessionActive(sessionId)) {
        throw new Error('Agent 正在运行，完成后再切换思考深度')
      }
      return updateAgentSessionMeta(sessionId, { reasoningLevel: thinkingLevel })
    }
  ipcMain.handle(AGENT_IPC_CHANNELS.UPDATE_SESSION_THINKING_LEVEL, handleSessionReasoningLevelUpdate)
  ipcMain.handle(AGENT_IPC_CHANNELS.UPDATE_SESSION_REASONING_LEVEL, handleSessionReasoningLevelUpdate)

  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPDATE_SESSION_AGENT_RUNTIME,
    async (): Promise<AgentSessionMeta> => {
      throw new Error('Agent runtime 已统一为 Pi，不支持内核切换。')
    }
  )
}
