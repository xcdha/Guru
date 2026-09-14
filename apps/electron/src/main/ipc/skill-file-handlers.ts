/**
 * skill-file-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「Skill 子文件管理」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { createSkillEntry, deleteSkillEntry, listSkillFiles, readSkillFile, renameSkillEntry, writeSkillFile } from '../lib/agent-workspace-manager'
import { AGENT_IPC_CHANNELS } from '@guru/shared'
import type { SkillScope } from '@guru/shared'
import { ipcMain } from 'electron'

export function registerSkillFileHandlers(): void {
  // ===== Skill 子文件管理 =====
  // 以下通道均支持可选 scope/projectId 参数（默认 scope='workspace' 保持既有行为不变），
  // 用于定位到全局/项目层 Skill 的子文件。

  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_SKILL_FILES,
    async (_, workspaceSlug: string, skillSlug: string, scope?: SkillScope, projectId?: string) => {
      return listSkillFiles(workspaceSlug, skillSlug, scope, projectId)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.READ_SKILL_FILE,
    async (_, workspaceSlug: string, skillSlug: string, relativePath: string, scope?: SkillScope, projectId?: string) => {
      return readSkillFile(workspaceSlug, skillSlug, relativePath, scope, projectId)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.WRITE_SKILL_FILE,
    async (_, workspaceSlug: string, skillSlug: string, relativePath: string, content: string, scope?: SkillScope, projectId?: string): Promise<void> => {
      writeSkillFile(workspaceSlug, skillSlug, relativePath, content, scope, projectId)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.CREATE_SKILL_ENTRY,
    async (_, workspaceSlug: string, skillSlug: string, relativePath: string, type: 'file' | 'directory', scope?: SkillScope, projectId?: string): Promise<void> => {
      createSkillEntry(workspaceSlug, skillSlug, relativePath, type, scope, projectId)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_SKILL_ENTRY,
    async (_, workspaceSlug: string, skillSlug: string, relativePath: string, scope?: SkillScope, projectId?: string): Promise<void> => {
      deleteSkillEntry(workspaceSlug, skillSlug, relativePath, scope, projectId)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.RENAME_SKILL_ENTRY,
    async (_, workspaceSlug: string, skillSlug: string, fromRelative: string, toRelative: string, scope?: SkillScope, projectId?: string): Promise<void> => {
      renameSkillEntry(workspaceSlug, skillSlug, fromRelative, toRelative, scope, projectId)
    }
  )
}
