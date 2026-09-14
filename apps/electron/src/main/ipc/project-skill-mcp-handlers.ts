/**
 * project-skill-mcp-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「项目级 Skills」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { batchImportSkillsFromWorkspaces, batchImportSkillsToProject, deleteProjectSkill, getOtherProjectSkills, getProjectSkills, getProjectSkillsDir, hasProjectSkills, importSkillFromOrganization, importSkillFromWorkspace, readWorkspaceSkillContent, removeWorkspaceMcpServer, toggleProjectSkill, updateSkillFromOrganizationSource, updateSkillFromSource, writeWorkspaceSkillContent } from '../lib/agent-workspace-manager'
import { fetchCommunityManifest, installCommunitySkill } from '../lib/community-skill-service'
import { getWorkspaceSkillsDir } from '../lib/config-paths'
import { clearOrganizationConnection, getOrganizationConnection, orgConnectWithApiKey, orgCreate, orgJoin, orgListMembers, orgListSkills, orgLogin, orgMe, orgRegister, setOrganizationConnection } from '../lib/org-skill-service'
import { AGENT_IPC_CHANNELS } from '@guru/shared'
import type { BulkImportProjectSelection, BulkImportSkillsResult, BulkImportWorkspaceSelection, CommunitySkill, CommunitySkillInstallResult, OtherProjectSkillsGroup, SkillMeta, SkillScope, WorkspaceMcpConfig } from '@guru/shared'
import { ipcMain } from 'electron'

export function registerProjectSkillMcpHandlers(): void {
  // ===== 项目级 Skills / MCP（嵌套 Project 可选覆盖工作区级，不影响上述工作区级通道） =====

  ipcMain.handle(
    AGENT_IPC_CHANNELS.HAS_PROJECT_SKILLS,
    async (_, workspaceSlug: string, projectId: string): Promise<boolean> => {
      return hasProjectSkills(workspaceSlug, projectId)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_PROJECT_SKILLS,
    async (_, workspaceSlug: string, projectId: string): Promise<SkillMeta[]> => {
      return getProjectSkills(workspaceSlug, projectId)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_PROJECT_SKILLS_DIR,
    async (_, workspaceSlug: string, projectId: string): Promise<string> => {
      return getProjectSkillsDir(workspaceSlug, projectId)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_PROJECT_SKILL,
    async (_, workspaceSlug: string, projectId: string, skillSlug: string): Promise<void> => {
      return deleteProjectSkill(workspaceSlug, projectId, skillSlug)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.TOGGLE_PROJECT_SKILL,
    async (_, workspaceSlug: string, projectId: string, skillSlug: string, enabled: boolean): Promise<void> => {
      return toggleProjectSkill(workspaceSlug, projectId, skillSlug, enabled)
    }
  )

  // 原子删除工作区内的单个 MCP 条目，基于主进程当前配置，避免渲染层旧快照整体回写时覆盖其他条目的新状态。
  // MCP 已对齐上游 #2037 为工作区级存储，项目级 MCP 覆盖已移除。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_MCP,
    async (_, workspaceSlug: string, name: string): Promise<WorkspaceMcpConfig> => {
      return removeWorkspaceMcpServer(workspaceSlug, name)
    }
  )

  // 获取同工作区内可导入到当前 Project 的 Skill 来源（工作区默认 + 其他嵌套 Project）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_OTHER_PROJECT_SKILLS,
    async (_, workspaceSlug: string, currentProjectId: string): Promise<OtherProjectSkillsGroup[]> => {
      return getOtherProjectSkills(workspaceSlug, currentProjectId)
    }
  )

  // 从工作区默认或其他嵌套 Project 批量导入 Skill 到当前 Project
  ipcMain.handle(
    AGENT_IPC_CHANNELS.BATCH_IMPORT_SKILLS_TO_PROJECT,
    async (_, workspaceSlug: string, targetProjectId: string, selections: BulkImportProjectSelection[]): Promise<BulkImportSkillsResult> => {
      return batchImportSkillsToProject(workspaceSlug, targetProjectId, selections)
    }
  )

  // 从其他工作区导入 Skill
  ipcMain.handle(
    AGENT_IPC_CHANNELS.IMPORT_SKILL_FROM_WORKSPACE,
    async (_, targetSlug: string, sourceSlug: string, skillSlug: string): Promise<SkillMeta> => {
      return importSkillFromWorkspace(targetSlug, sourceSlug, skillSlug)
    }
  )

  // 从其他工作区批量导入多个 Skill
  ipcMain.handle(
    AGENT_IPC_CHANNELS.BATCH_IMPORT_SKILLS_FROM_WORKSPACES,
    async (_, targetSlug: string, selections: BulkImportWorkspaceSelection[]): Promise<BulkImportSkillsResult> => {
      return batchImportSkillsFromWorkspaces(targetSlug, selections)
    }
  )

  // 从源工作区同步更新已导入的 Skill
  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPDATE_SKILL_FROM_SOURCE,
    async (_, targetSlug: string, skillSlug: string): Promise<SkillMeta> => {
      return updateSkillFromSource(targetSlug, skillSlug)
    }
  )

  // ── 企业版组织 Skills 分发 ───────────────────────────────

  // 获取组织连接配置
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ORG_GET_CONNECTION,
    async (): Promise<ReturnType<typeof getOrganizationConnection>> => {
      return getOrganizationConnection()
    }
  )

  // 登出（清除连接配置）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ORG_SET_CONNECTION,
    async (_, mode: 'logout' | 'set', conn?: Parameters<typeof setOrganizationConnection>[0]): Promise<ReturnType<typeof getOrganizationConnection>> => {
      if (mode === 'logout') {
        clearOrganizationConnection()
      } else if (conn) {
        setOrganizationConnection(conn)
      }
      return getOrganizationConnection()
    }
  )

  // 登录/注册/API Key 连接（写连接配置）
  ipcMain.handle(
    'org:authenticate',
    async (
      _,
      action: 'login' | 'register' | 'apikey',
      serverUrl: string,
      email: string,
      password: string,
      displayName?: string,
      apiKey?: string,
    ) => {
      if (action === 'apikey') {
        return orgConnectWithApiKey(serverUrl, apiKey ?? '')
      }
      return action === 'register'
        ? orgRegister(serverUrl, email, password, displayName)
        : orgLogin(serverUrl, email, password)
    }
  )

  // 我的组织与角色
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ORG_ME,
    async (): Promise<Awaited<ReturnType<typeof orgMe>>> => {
      const conn = getOrganizationConnection()
      if (!conn) throw new Error('未连接组织服务，请先登录')
      return orgMe(conn)
    }
  )

  // 创建组织
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ORG_CREATE,
    async (_, name: string): Promise<Awaited<ReturnType<typeof orgCreate>>> => {
      const conn = getOrganizationConnection()
      if (!conn) throw new Error('未连接组织服务，请先登录')
      return orgCreate(conn, name)
    }
  )

  // 凭邀请码加入组织
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ORG_JOIN,
    async (_, inviteCode: string): Promise<Awaited<ReturnType<typeof orgJoin>>> => {
      const conn = getOrganizationConnection()
      if (!conn) throw new Error('未连接组织服务，请先登录')
      return orgJoin(conn, inviteCode)
    }
  )

  // 列出组织成员
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ORG_LIST_MEMBERS,
    async (_, orgId: string): Promise<Awaited<ReturnType<typeof orgListMembers>>> => {
      const conn = getOrganizationConnection()
      if (!conn) throw new Error('未连接组织服务，请先登录')
      return orgListMembers(conn, orgId)
    }
  )

  // 列出组织 Skills
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ORG_LIST_SKILLS,
    async (_, orgId: string): Promise<Awaited<ReturnType<typeof orgListSkills>>> => {
      const conn = getOrganizationConnection()
      if (!conn) throw new Error('未连接组织服务，请先登录')
      return orgListSkills(conn, orgId)
    }
  )

  // 导入组织 Skill 到工作区
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ORG_IMPORT_SKILL,
    async (
      _,
      targetSlug: string,
      orgId: string,
      orgName: string,
      skill: Parameters<typeof importSkillFromOrganization>[4],
    ): Promise<SkillMeta> => {
      const conn = getOrganizationConnection()
      if (!conn) throw new Error('未连接组织服务，请先登录')
      return importSkillFromOrganization(targetSlug, conn, orgId, orgName, skill)
    }
  )

  // 从组织源更新已导入 Skill
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ORG_UPDATE_SKILL,
    async (_, targetSlug: string, skillSlug: string): Promise<SkillMeta> => {
      const conn = getOrganizationConnection()
      if (!conn) throw new Error('未连接组织服务，请先登录')
      return updateSkillFromOrganizationSource(targetSlug, skillSlug, conn)
    }
  )

  // ── 社区市场 ─────────────────────────────────

  // 拉取社区市场清单
  ipcMain.handle(
    AGENT_IPC_CHANNELS.COMMUNITY_FETCH_MANIFEST,
    async (): Promise<CommunitySkill[]> => {
      return fetchCommunityManifest()
    }
  )

  // 安装社区市场 Skill 到工作区
  ipcMain.handle(
    AGENT_IPC_CHANNELS.COMMUNITY_INSTALL_SKILL,
    async (_, workspaceSlug: string, skill: CommunitySkill): Promise<CommunitySkillInstallResult> => {
      const { getWorkspaceSkillsDir } = await import('../lib/config-paths')
      const dir = getWorkspaceSkillsDir(workspaceSlug)
      return installCommunitySkill(dir, skill)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.READ_SKILL_CONTENT,
    async (_, workspaceSlug: string, skillSlug: string, scope?: SkillScope, projectId?: string): Promise<string> => {
      return readWorkspaceSkillContent(workspaceSlug, skillSlug, scope, projectId)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.WRITE_SKILL_CONTENT,
    async (_, workspaceSlug: string, skillSlug: string, content: string, scope?: SkillScope, projectId?: string): Promise<void> => {
      writeWorkspaceSkillContent(workspaceSlug, skillSlug, content, scope, projectId)
    }
  )
}
