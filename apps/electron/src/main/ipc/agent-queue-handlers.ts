/**
 * agent-queue-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「Agent 队列消息」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { cancelAgentQueuedMessage, enqueueAgentQueuedMessage, getAgentQueuedMessageSnapshots, moveAgentQueuedMessage, pokeAgentQueuedMessages, queueAgentMessage } from '../lib/agent-service'
import { AGENT_IPC_CHANNELS } from '@guru/shared'
import { ipcMain } from 'electron'

export function registerAgentQueueHandlers(): void {
  // ===== Agent 队列消息 =====

  // 排队发送消息
  ipcMain.handle(
    AGENT_IPC_CHANNELS.QUEUE_MESSAGE,
    async (event, input: import('@guru/shared').AgentQueueMessageInput): Promise<string> => {
      return queueAgentMessage(input, event.sender)
    }
  )

  // 将等待当前 run 结束的消息交给主进程调度器
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ENQUEUE_QUEUED_MESSAGE,
    async (event, input: import('@guru/shared').AgentDeferredQueueMessageInput): Promise<void> => {
      enqueueAgentQueuedMessage(input, event.sender)
    }
  )

  // 获取主进程 deferred queue 的展示投影（renderer 重载后重建队列 UI）。
  // renderer 重新挂载/窗口重开是天然的重连信号：顺手 poke 一次，
  // 让因 webContents 缺失而搁置的派发在 renderer 回来后恢复。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_QUEUED_MESSAGES,
    async (_, sessionId: string): Promise<import('@guru/shared').AgentQueuedMessageSnapshot[]> => {
      const snapshots = getAgentQueuedMessageSnapshots(sessionId)
      pokeAgentQueuedMessages()
      return snapshots
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.CANCEL_QUEUED_MESSAGE,
    async (_, input: import('@guru/shared').AgentQueuedMessageControlInput): Promise<boolean> => {
      return cancelAgentQueuedMessage(input)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.MOVE_QUEUED_MESSAGE,
    async (_, input: import('@guru/shared').AgentMoveQueuedMessageInput): Promise<boolean> => {
      return moveAgentQueuedMessage(input)
    }
  )
}
