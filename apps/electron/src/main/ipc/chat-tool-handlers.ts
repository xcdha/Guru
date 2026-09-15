/**
 * chat-tool-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「Chat 工具管理」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { addCustomTool, deleteCustomTool, getToolCredentials, updateToolCredentials, updateToolState } from '../lib/chat-tool-config'
import { getAllToolInfos } from '../lib/chat-tool-registry'
import { CHAT_TOOL_IPC_CHANNELS } from '@guru/shared'
import type { ChatToolInfo, ChatToolMeta, ChatToolState } from '@guru/shared'
import { ipcMain } from 'electron'

export function registerChatToolHandlers(): void {
  // ===== Chat 工具管理 =====

  // 获取所有工具信息
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.GET_ALL_TOOLS,
    async (): Promise<ChatToolInfo[]> => {
      return getAllToolInfos()
    }
  )

  // 获取工具凭据
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.GET_TOOL_CREDENTIALS,
    async (_, toolId: string): Promise<Record<string, string>> => {
      return getToolCredentials(toolId)
    }
  )

  // 更新工具开关状态
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.UPDATE_TOOL_STATE,
    async (_, toolId: string, state: ChatToolState): Promise<void> => {
      updateToolState(toolId, state)
    }
  )

  // 更新工具凭据
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.UPDATE_TOOL_CREDENTIALS,
    async (_, toolId: string, credentials: Record<string, string>): Promise<void> => {
      updateToolCredentials(toolId, credentials)
    }
  )

  // 创建自定义工具
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.CREATE_CUSTOM_TOOL,
    async (_, meta: ChatToolMeta): Promise<void> => {
      addCustomTool(meta)
    }
  )

  // 删除自定义工具
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.DELETE_CUSTOM_TOOL,
    async (_, toolId: string): Promise<void> => {
      deleteCustomTool(toolId)
    }
  )

  // 测试工具连接
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.TEST_TOOL,
    async (_, toolId: string): Promise<{ success: boolean; message: string }> => {
      // Nano Banana 生图工具测试
      if (toolId === 'nano-banana') {
        const { getToolCredentials: getCredentials } = await import('../lib/chat-tool-config')
        const credentials = getCredentials('nano-banana')
        if (!credentials.apiKey) {
          return { success: false, message: '请先填写 API Key' }
        }
        try {
          // ===== OpenAI Images 协议分支 =====
          if (credentials.provider === 'openai-images') {
            const baseUrl = (credentials.baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '')
            const model = credentials.model?.trim() || 'gpt-image-2'
            // 用 GET /models 验证 key 有效性（不消耗生图额度）
            const response = await fetch(`${baseUrl}/models`, {
              headers: { Authorization: `Bearer ${credentials.apiKey}` },
              signal: AbortSignal.timeout(15_000),
            })
            if (!response.ok) {
              const errorText = await response.text()
              return { success: false, message: `API 请求失败 (${response.status}): ${errorText.slice(0, 200)}` }
            }
            return { success: true, message: `连接成功，模型 ${model} 将在生成时调用` }
          }

          // ===== Gemini 协议分支 =====
          const baseUrl = credentials.baseUrl?.trim() || 'https://generativelanguage.googleapis.com'
          const model = credentials.model?.trim() || 'gemini-3.1-flash-image-preview'
          const url = `${baseUrl}/v1beta/models/${model}:generateContent`
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // 与调用路径一致：header 认证兼容官方与 nbility 等中转
              'x-goog-api-key': credentials.apiKey,
            },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
              generationConfig: { maxOutputTokens: 10 },
            }),
            signal: AbortSignal.timeout(15_000),
          })
          if (!response.ok) {
            const errorText = await response.text()
            return { success: false, message: `API 请求失败 (${response.status}): ${errorText.slice(0, 200)}` }
          }
          return { success: true, message: `连接成功，模型 ${model} 可用` }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          return { success: false, message: `连接失败: ${msg}` }
        }
      }
      return { success: false, message: `工具 ${toolId} 不支持测试` }
    }
  )
}
