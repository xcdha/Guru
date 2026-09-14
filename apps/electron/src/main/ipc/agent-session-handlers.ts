/**
 * agent-session-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「Agent 会话管理相关」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 * 同时迁入仅被该组使用的辅助声明: collectSessionDescendantIds
 */

import { askUserService } from '../lib/agent-ask-user-service'
import { exitPlanService } from '../lib/agent-exit-plan-service'
import { permissionService } from '../lib/agent-permission-service'
import { clearAgentQueuedMessages, generateAgentTitle, isAgentSessionActive, isAgentSessionBusy, rewindAgentSession, stopAgent } from '../lib/agent-service'
import { createAgentSession, deleteAgentSession, forkAgentSession, getAgentSessionMeta, getAgentSessionSDKMessages, listAgentSessions, migrateChatToAgentSession, moveSessionToWorkspace, searchAgentSessionMessages, searchAgentSessionReferences, updateAgentSessionMeta } from '../lib/agent-session-manager'
import { browserController } from '../lib/browser-controller'
import { resolveBrowserProfileKey } from '../lib/browser-profile-policy'
import { feishuBridgeManager } from '../lib/feishu-bridge-manager'
import { normalizeFileAccessOptions } from '../lib/file-access-policy'
import { getMainRepoRoot, listWorktrees } from '../lib/git-diff-service'
import { ensurePathAllowedWithWorktree, realpathOrResolve } from './path-access'
import { AGENT_IPC_CHANNELS, normalizePathForCompare } from '@guru/shared'
import type { AgentGenerateTitleInput, AgentSessionMeta, AgentSessionReferenceSearchInput, BrowserCreateTabInput, BrowserNavigateInput, BrowserTabInput, BrowserViewLayout, BrowserViewState, ForkSessionInput, MoveSessionToWorkspaceInput, RewindSessionInput, RewindSessionResult, SDKMessage, SetAgentSessionActiveWorktreeInput } from '@guru/shared'
import { ipcMain } from 'electron'

function collectSessionDescendantIds(sessions: AgentSessionMeta[], rootId: string): string[] {
  const childrenByParent = new Map<string, AgentSessionMeta[]>()
  for (const session of sessions) {
    if (!session.parentSessionId) continue
    const children = childrenByParent.get(session.parentSessionId) ?? []
    children.push(session)
    childrenByParent.set(session.parentSessionId, children)
  }

  const result: string[] = []
  const queue = [...(childrenByParent.get(rootId) ?? [])]
  const seen = new Set<string>([rootId])
  while (queue.length > 0) {
    const child = queue.shift()!
    if (seen.has(child.id)) continue
    seen.add(child.id)
    result.push(child.id)
    queue.push(...(childrenByParent.get(child.id) ?? []))
  }

  return result.reverse()
}

export function registerAgentSessionHandlers(): void {
  // ===== Agent 会话管理相关 =====

  // 获取 Agent 会话列表
  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_SESSIONS,
    async (): Promise<AgentSessionMeta[]> => listAgentSessions()
  )

  // 创建 Agent 会话
  ipcMain.handle(
    AGENT_IPC_CHANNELS.CREATE_SESSION,
    async (_, title?: string, channelId?: string, workspaceId?: string, modelId?: string): Promise<AgentSessionMeta> => {
      const session = createAgentSession(title, channelId, workspaceId, modelId, undefined)
      feishuBridgeManager.ensureSessionMirror(session).catch((error) => {
        console.error('[飞书 Session 镜像] 新会话建群失败:', error)
      })
      return session
    }
  )

  // 受管浏览器：renderer 只能投影状态和更新 slot 布局，不能取得 WebContents/CDP。
  const assertMainRenderer = async (senderId: number): Promise<void> => {
    const { getMainWindow } = await import('../index')
    const mainWindow = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.id !== senderId) {
      throw new Error('仅主窗口可以操作受管浏览器。')
    }
  }
  const assertBrowserSessionAccess = async (senderId: number, sessionId: string): Promise<void> => {
    await assertMainRenderer(senderId)
    const session = getAgentSessionMeta(sessionId)
    if (!session) throw new Error('Agent 会话不存在。')
    // 自动任务与协作子会话同样可以使用受管浏览器；仅校验会话仍存在。
    browserController.configureSession(sessionId, {
      profileKey: resolveBrowserProfileKey(session.workspaceId, sessionId),
      executionSource: session.sourceDelegationId ? 'delegation' : session.sourceAutomationId ? 'automation' : 'user',
    })
  }

  ipcMain.handle(
    AGENT_IPC_CHANNELS.OPEN_BROWSER,
    async (event, sessionId: string): Promise<BrowserViewState> => {
      await assertBrowserSessionAccess(event.sender.id, sessionId)
      return browserController.open(sessionId)
    },
  )
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_BROWSER_STATE,
    async (event, sessionId: string): Promise<BrowserViewState | null> => {
      await assertBrowserSessionAccess(event.sender.id, sessionId)
      return browserController.getState(sessionId)
    },
  )
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SET_BROWSER_LAYOUT,
    async (event, layout: BrowserViewLayout): Promise<void> => {
      if (!layout || typeof layout.sessionId !== 'string' || !layout.bounds || !Number.isSafeInteger(layout.revision)) throw new Error('无效的浏览器布局。')
      await assertBrowserSessionAccess(event.sender.id, layout.sessionId)
      browserController.setLayout(layout)
    },
  )
  ipcMain.handle(
    AGENT_IPC_CHANNELS.MINIMIZE_BROWSER,
    async (event, sessionId: string): Promise<void> => {
      await assertBrowserSessionAccess(event.sender.id, sessionId)
      browserController.minimize(sessionId)
    },
  )
  ipcMain.handle(
    AGENT_IPC_CHANNELS.HIDE_BROWSER_PRESENTATION,
    async (event, revision: number): Promise<void> => {
      await assertMainRenderer(event.sender.id)
      if (!Number.isSafeInteger(revision)) throw new Error('无效的浏览器展示 revision。')
      browserController.hidePresentation(revision)
    },
  )
  ipcMain.handle(
    AGENT_IPC_CHANNELS.NAVIGATE_BROWSER,
    async (event, input: BrowserNavigateInput): Promise<BrowserViewState> => {
      await assertBrowserSessionAccess(event.sender.id, input.sessionId)
      return browserController.navigateDisplay(input.sessionId, input.url, input.tabId)
    },
  )
  ipcMain.handle(AGENT_IPC_CHANNELS.GO_BACK_BROWSER, async (event, sessionId: string) => {
    await assertBrowserSessionAccess(event.sender.id, sessionId)
    return browserController.goBackDisplay(sessionId)
  })
  ipcMain.handle(AGENT_IPC_CHANNELS.GO_FORWARD_BROWSER, async (event, sessionId: string) => {
    await assertBrowserSessionAccess(event.sender.id, sessionId)
    return browserController.goForwardDisplay(sessionId)
  })
  ipcMain.handle(AGENT_IPC_CHANNELS.RELOAD_BROWSER, async (event, sessionId: string) => {
    await assertBrowserSessionAccess(event.sender.id, sessionId)
    return browserController.reloadDisplay(sessionId)
  })
  ipcMain.handle(AGENT_IPC_CHANNELS.CLOSE_BROWSER, async (event, sessionId: string): Promise<void> => {
    await assertBrowserSessionAccess(event.sender.id, sessionId)
    await browserController.close(sessionId)
  })
  ipcMain.handle(AGENT_IPC_CHANNELS.LIST_BROWSER_TABS, async (event, sessionId: string): Promise<BrowserViewState> => {
    await assertBrowserSessionAccess(event.sender.id, sessionId)
    return browserController.listTabs(sessionId)
  })
  ipcMain.handle(AGENT_IPC_CHANNELS.CREATE_BROWSER_TAB, async (event, input: BrowserCreateTabInput): Promise<BrowserViewState> => {
    await assertBrowserSessionAccess(event.sender.id, input.sessionId)
    return browserController.createDisplayTab(input.sessionId, input.url)
  })
  ipcMain.handle(AGENT_IPC_CHANNELS.SELECT_BROWSER_TAB, async (event, input: BrowserTabInput): Promise<BrowserViewState> => {
    await assertBrowserSessionAccess(event.sender.id, input.sessionId)
    if (!input.tabId) throw new Error('tabId 必填。')
    return browserController.selectTab(input.sessionId, input.tabId)
  })
  ipcMain.handle(AGENT_IPC_CHANNELS.CLOSE_BROWSER_TAB, async (event, input: BrowserTabInput): Promise<BrowserViewState | null> => {
    await assertBrowserSessionAccess(event.sender.id, input.sessionId)
    if (!input.tabId) throw new Error('tabId 必填。')
    return browserController.closeTab(input.sessionId, input.tabId)
  })


  // 获取 Agent 会话 SDKMessage（Phase 4 新格式）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_SDK_MESSAGES,
    async (_, id: string): Promise<SDKMessage[]> => {
      return getAgentSessionSDKMessages(id)
    }
  )

  // 更新 Agent 会话标题
  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPDATE_TITLE,
    async (_, id: string, title: string): Promise<AgentSessionMeta> => {
      return updateAgentSessionMeta(id, { title, titleSource: 'manual' })
    }
  )

  // 更新 Agent 会话模型选择
  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPDATE_SESSION_MODEL,
    async (_, id: string, channelId?: string, modelId?: string): Promise<AgentSessionMeta> => {
      // 模型切换允许在运行中提交；当前 query 继续使用启动时的模型，下一轮读取新配置。
      return updateAgentSessionMeta(id, { channelId, modelId })
    }
  )

  // 选择或清除 Agent 会话的活动 worktree
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SET_ACTIVE_WORKTREE,
    async (_, input: SetAgentSessionActiveWorktreeInput): Promise<AgentSessionMeta> => {
      if (!input || typeof input.sessionId !== 'string' || (input.worktreePath !== null && typeof input.worktreePath !== 'string')) {
        throw new Error('活动 worktree 参数无效')
      }
      const session = getAgentSessionMeta(input.sessionId)
      if (!session) throw new Error(`Agent 会话不存在: ${input.sessionId}`)
      if (input.worktreePath === null) {
        return updateAgentSessionMeta(input.sessionId, { activeWorktree: undefined })
      }

      const access = normalizeFileAccessOptions({ sessionId: input.sessionId })
      if (!(await ensurePathAllowedWithWorktree(input.worktreePath, access))) {
        throw new Error('无权将该目录设为活动 worktree')
      }

      const requestedPath = normalizePathForCompare(realpathOrResolve(input.worktreePath))
      const selected = (await listWorktrees(input.worktreePath)).find((worktree) =>
        !worktree.isMain && normalizePathForCompare(realpathOrResolve(worktree.path)) === requestedPath,
      )
      if (!selected) throw new Error('指定目录不是可用的 linked worktree')

      const mainRepoRoot = await getMainRepoRoot(selected.path)
      if (!mainRepoRoot) throw new Error('无法确认 worktree 的主仓库')
      return updateAgentSessionMeta(input.sessionId, {
        activeWorktree: {
          path: realpathOrResolve(selected.path),
          mainRepoRoot: realpathOrResolve(mainRepoRoot),
          branch: selected.branch,
          selectedAt: Date.now(),
        },
      })
    },
  )

  // 生成 Agent 会话标题
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GENERATE_TITLE,
    async (_, input: AgentGenerateTitleInput): Promise<string | null> => {
      return generateAgentTitle(input)
    }
  )

  // 删除 Agent 会话
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_SESSION,
    async (_, id: string): Promise<void> => {
      const sessions = listAgentSessions()
      const target = sessions.find((session) => session.id === id)
      const idsToDelete = target?.taskDraft
        ? collectSessionDescendantIds(sessions, id).concat(id)
        : [id]

      for (const sessionId of idsToDelete) {
        if (isAgentSessionActive(sessionId)) stopAgent(sessionId)
        // 清理权限服务中该会话的白名单
        permissionService.clearSessionWhitelist(sessionId)
        permissionService.clearSessionPending(sessionId)
        // 清理 AskUser 服务中的待处理请求
        askUserService.clearSessionPending(sessionId)
        // 清理 ExitPlanMode 服务中的待处理请求
        exitPlanService.clearSessionPending(sessionId)
        // 清理主进程 deferred queue
        clearAgentQueuedMessages(sessionId)
        // 清理受管浏览器会话
        await browserController.close(sessionId)
        deleteAgentSession(sessionId)
      }
    }
  )

  // 迁移 Chat 对话记录到 Agent 会话
  ipcMain.handle(
    AGENT_IPC_CHANNELS.MIGRATE_CHAT_TO_AGENT,
    async (_, conversationId: string, agentSessionId: string): Promise<void> => {
      migrateChatToAgentSession(conversationId, agentSessionId)
    }
  )

  // 切换 Agent 会话置顶状态
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TOGGLE_PIN,
    async (_, id: string): Promise<AgentSessionMeta> => {
      const sessions = listAgentSessions()
      const current = sessions.find((s) => s.id === id)
      if (!current) throw new Error(`Agent session not found: ${id}`)
      const newPinned = !current.pinned
      // 置顶时自动取消归档
      const updates: Partial<AgentSessionMeta> = { pinned: newPinned }
      if (newPinned && current.archived) {
        updates.archived = false
      }
      return updateAgentSessionMeta(id, updates)
    }
  )

  // 切换 Agent 会话星标状态
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TOGGLE_STAR,
    async (_, id: string): Promise<AgentSessionMeta> => {
      const sessions = listAgentSessions()
      const current = sessions.find((s) => s.id === id)
      if (!current) throw new Error(`Agent session not found: ${id}`)
      return updateAgentSessionMeta(id, { starred: !current.starred })
    }
  )

  // 清除 Agent 会话完成状态（兼容清除旧版 manualWorking）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.CLEAR_COMPLETION_STATE,
    async (_, id: string): Promise<AgentSessionMeta> => {
      const sessions = listAgentSessions()
      const current = sessions.find((s) => s.id === id)
      if (!current) throw new Error(`Agent session not found: ${id}`)
      const updates: Partial<AgentSessionMeta> = {}
      if (current.manualWorking) updates.manualWorking = false
      if (current.completedButUnconfirmed) updates.completedButUnconfirmed = false
      if (Object.keys(updates).length === 0) return current
      return updateAgentSessionMeta(id, updates)
    }
  )

  // 切换 Agent 会话归档状态
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TOGGLE_ARCHIVE,
    async (_, id: string): Promise<AgentSessionMeta> => {
      const sessions = listAgentSessions()
      const current = sessions.find((s) => s.id === id)
      if (!current) throw new Error(`Agent session not found: ${id}`)
      const newArchived = !current.archived
      // 归档时自动取消置顶
      const updates: Partial<AgentSessionMeta> = { archived: newArchived }
      if (newArchived && current.pinned) {
        updates.pinned = false
      }
      return updateAgentSessionMeta(id, updates)
    }
  )

  // 搜索 Agent 会话消息内容
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SEARCH_MESSAGES,
    async (_, query: string) => {
      return searchAgentSessionMessages(query)
    }
  )

  // 搜索可引用的 Agent 会话；省略 workspaceId 时跨工作区搜索。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SEARCH_SESSION_REFERENCES,
    async (_, input: AgentSessionReferenceSearchInput) => {
      return searchAgentSessionReferences(input)
    }
  )

  // 迁移 Agent 会话到另一个工作区
  ipcMain.handle(
    AGENT_IPC_CHANNELS.MOVE_SESSION_TO_WORKSPACE,
    async (_, input: MoveSessionToWorkspaceInput): Promise<AgentSessionMeta> => {
      if (isAgentSessionBusy(input.sessionId)) {
        throw new Error('会话正在启动、运行或仍有排队消息，请停止或清空队列后再迁移')
      }
      const moved = moveSessionToWorkspace(input.sessionId, input.targetWorkspaceId)
      feishuBridgeManager.syncWorkspaceForSession(moved.id, moved.workspaceId!)
      return moved
    }
  )

  // 分叉 Agent 会话
  ipcMain.handle(
    AGENT_IPC_CHANNELS.FORK_SESSION,
    async (_, input: ForkSessionInput): Promise<AgentSessionMeta> => {
      const session = await forkAgentSession(input)
      // Fork 直接在 session manager 内创建元数据，绕过 CREATE_SESSION 的镜像生命周期。
      // 将它作为新的桌面会话处理，确保 Pi fork 也会立即获得可双向续聊的飞书群。
      feishuBridgeManager.ensureSessionMirror(session).catch((error) => {
        console.error('[飞书 Session 镜像] 分叉会话建群失败:', error)
      })
      return session
    }
  )

  // 快照回退（同一会话内回退到指定点）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.REWIND_SESSION,
    async (_, input: RewindSessionInput): Promise<RewindSessionResult> => {
      return rewindAgentSession(
        input.sessionId,
        input.assistantMessageUuid,
      )
    }
  )
}
