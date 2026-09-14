/**
 * system-prompt-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「系统提示词管理」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { createSystemPrompt, deleteSystemPrompt, getSystemPromptConfig, setDefaultPrompt, updateAppendSetting, updateSystemPrompt } from '../lib/system-prompt-manager'
import { SYSTEM_PROMPT_IPC_CHANNELS } from '@guru/shared'
import type { SystemPrompt, SystemPromptConfig, SystemPromptCreateInput, SystemPromptUpdateInput } from '@guru/shared'
import { ipcMain } from 'electron'

export function registerSystemPromptHandlers(): void {
  // ===== 系统提示词管理 =====

  // 获取系统提示词配置
  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.GET_CONFIG,
    async (): Promise<SystemPromptConfig> => {
      return getSystemPromptConfig()
    }
  )

  // 创建提示词
  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.CREATE,
    async (_, input: SystemPromptCreateInput): Promise<SystemPrompt> => {
      return createSystemPrompt(input)
    }
  )

  // 更新提示词
  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.UPDATE,
    async (_, id: string, input: SystemPromptUpdateInput): Promise<SystemPrompt> => {
      return updateSystemPrompt(id, input)
    }
  )

  // 删除提示词
  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.DELETE,
    async (_, id: string): Promise<void> => {
      return deleteSystemPrompt(id)
    }
  )

  // 更新追加日期时间和用户名开关
  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.UPDATE_APPEND_SETTING,
    async (_, enabled: boolean): Promise<void> => {
      return updateAppendSetting(enabled)
    }
  )

  // 设置默认提示词
  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.SET_DEFAULT,
    async (_, id: string | null): Promise<void> => {
      return setDefaultPrompt(id)
    }
  )
}
