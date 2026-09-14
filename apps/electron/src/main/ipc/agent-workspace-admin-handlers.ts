/**
 * agent-workspace-admin-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「Agent 工作区管理相关」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { isAgentSessionActive, stopAgent } from '../lib/agent-service'
import { assertAgentSessionDeletionSafe, deleteAgentSession, listAgentSessions } from '../lib/agent-session-manager'
import { assertAgentWorkspaceDeletionSafe, createAgentWorkspace, deleteAgentWorkspace, ensureDefaultWorkspace, getAgentWorkspace, listAgentWorkspaces, relinkAgentWorkspaceProjectRoot, reorderAgentWorkspaces, restoreAgentWorkspaceProjectRoot, updateAgentWorkspace } from '../lib/agent-workspace-manager'
import { deleteAutomation, listAutomations } from '../lib/automation-manager'
import { broadcastChanged as broadcastAutomationsChanged } from '../lib/automation-scheduler'
import { getProjectToWorkspaceMigrationStatus, runProjectToWorkspaceMigration } from '../lib/project-to-workspace-migration'
import type { ProjectToWorkspaceMigrationResult } from '../lib/project-to-workspace-migration'
import { deleteWorkspaceCascade } from '../lib/workspace-deletion-service'
import { AGENT_IPC_CHANNELS } from '@guru/shared'
import type { AgentWorkspace } from '@guru/shared'
import { ipcMain } from 'electron'

export function registerAgentWorkspaceAdminHandlers(): void {
  // ===== Agent 工作区管理相关 =====

  // 确保默认工作区存在
  ensureDefaultWorkspace()

  // 获取 Agent 工作区列表
  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_WORKSPACES,
    async (): Promise<AgentWorkspace[]> => {
      return listAgentWorkspaces()
    }
  )

  // 创建 Agent 工作区（支持绑定本地项目根目录：从本地文件夹创建项目）
  // deferSkillsCopy: 交互式入口总是后台拷贝默认 Skills，避免同步 cpSync 阻塞主线程导致创建项目时 UI 卡顿；
  // 迁移等内部同进程调用不走这个 handler，不受影响。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.CREATE_WORKSPACE,
    async (_event, input: string | { name: string; projectRootPath?: string }): Promise<AgentWorkspace> => {
      const normalized = typeof input === 'string' ? { name: input } : input
      return createAgentWorkspace({ ...normalized, deferSkillsCopy: true })
    }
  )

  // 更新 Agent 工作区
  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPDATE_WORKSPACE,
    async (_, id: string, updates: { name?: string; kanbanColumns?: import('@guru/shared').KanbanColumnDef[] }): Promise<AgentWorkspace> => {
      return updateAgentWorkspace(id, updates)
    }
  )

  // 删除 Agent 工作区
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_WORKSPACE,
    async (_, id: string): Promise<void> => {
      deleteWorkspaceCascade(id, {
        getWorkspace: getAgentWorkspace,
        listWorkspaces: listAgentWorkspaces,
        listSessions: listAgentSessions,
        listAutomations,
        isSessionActive: isAgentSessionActive,
        assertSessionDeletionSafe: assertAgentSessionDeletionSafe,
        assertWorkspaceDeletionSafe: assertAgentWorkspaceDeletionSafe,
        stopSession: stopAgent,
        deleteSession: deleteAgentSession,
        deleteAutomation,
        broadcastAutomationsChanged,
        deleteWorkspace: deleteAgentWorkspace,
      })
    }
  )

  // 重排工作区顺序
  ipcMain.handle(
    AGENT_IPC_CHANNELS.REORDER_WORKSPACES,
    async (_, orderedIds: string[]): Promise<AgentWorkspace[]> => {
      return reorderAgentWorkspaces(orderedIds)
    }
  )

  // 重新关联工作区本地项目根目录（从本地文件夹创建/重新绑定项目）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.RELINK_WORKSPACE_PROJECT_ROOT,
    async (_event, id: string, projectRootPath: string): Promise<AgentWorkspace> => {
      return relinkAgentWorkspaceProjectRoot(id, projectRootPath)
    }
  )

  // 在缺失的原路径恢复空项目根目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.RESTORE_WORKSPACE_PROJECT_ROOT,
    async (_event, id: string): Promise<AgentWorkspace> => {
      return restoreAgentWorkspaceProjectRoot(id)
    }
  )

  // 查询项目→工作区迁移状态（阶段二，手动触发入口状态）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_PROJECT_WORKSPACE_MIGRATION_STATUS,
    async (_event, workspaceId: string): Promise<{ done: boolean; pendingCount: number }> => {
      return getProjectToWorkspaceMigrationStatus(workspaceId)
    }
  )

  // 执行项目→工作区迁移（手动触发，含备份；幂等）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.RUN_PROJECT_WORKSPACE_MIGRATION,
    async (_event, workspaceId: string): Promise<ProjectToWorkspaceMigrationResult> => {
      return runProjectToWorkspaceMigration(workspaceId)
    }
  )
}
