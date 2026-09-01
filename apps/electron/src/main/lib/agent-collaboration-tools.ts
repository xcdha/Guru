/**
 * Agent 内置协作会话工具
 *
 * 通过 SDK MCP Server 暴露 Guru Agent 子会话委派能力。
 * Skill 负责判断何时协作；这里负责受控创建真实 Agent 会话、运行、等待和停止。
 */

import { randomUUID } from 'node:crypto'
import type {
  AgentDelegationRole,
  AgentDelegationStatus,
  AgentMessage,
  AgentRuntime,
  AgentSessionMeta,
  AgentStreamPayload,
  AskUserRequest,
  PermissionRequest,
  GuruPermissionMode,
  SDKMessage,
} from '@guru/shared'
import {
  createAgentSession,
  getAgentSessionMeta,
  getAgentSessionSDKMessages,
  listAgentSessions,
  updateAgentSessionMeta,
} from './agent-session-manager'
import {
  runRegisteredHeadlessAgent,
  stopRegisteredAgent,
} from './agent-headless-runner-registry'
import {
  DEFAULT_DELEGATION_WAIT_SECONDS,
  MAX_DELEGATION_WAIT_SECONDS,
  MAX_RUNNING_DELEGATIONS_PER_PARENT,
  buildRecoveredDelegationState,
  buildDelegationTaskWithSharedContext,
  buildDelegationPrompt,
  createToolCallIdempotencyCache,
  resolveDelegationPermissionMode,
} from './agent-collaboration-utils'
import { assertEnabledModelForChannel, listEnabledAgentModelsForChannel } from './agent-model-selection'

interface CollaborationToolContext {
  sessionId: string
  channelId: string
  modelId?: string
  workspaceId?: string
  permissionMode?: GuruPermissionMode
  agentRuntime?: AgentRuntime
  triggeredBy?: 'user' | 'automation' | 'delegation' | 'work'
}

interface CollaborationToolResult extends Record<string, unknown> {
  content: Array<{ type: 'text'; text: string }>
}

interface DelegationRecord {
  delegationId: string
  parentSessionId: string
  childSessionId: string
  channelId: string
  modelId?: string
  /** 父会话中委派工具的 toolCallId（渲染层按它关联活动 UI） */
  parentToolUseId?: string
  title: string
  role: AgentDelegationRole
  goal: string
  permissionMode: GuruPermissionMode
  status: AgentDelegationStatus
  startedAt: number
  completedAt?: number
  error?: string
  resultSummary?: string
  completion: Promise<void>
  resolveCompletion: () => void
}

type ZodModule = typeof import('zod')

const RESULT_SUMMARY_CHAR_LIMIT = 50_000
const DELEGATION_GOAL_CHAR_LIMIT = 1_000
/** live Map 中保留的已结束委派上限，超出时按完成时间清理最老的（持久化仍可回查） */
const MAX_RETAINED_FINISHED_DELEGATIONS = 200

const delegations = new Map<string, DelegationRecord>()
/** childSessionId → delegationId 索引（eventBus 事件 O(1) 查找） */
const delegationByChildSession = new Map<string, string>()

/** delegation_progress 转发去重/节流状态 */
/** 已转发过的 tool_start（key: delegationId + ':' + toolUseId），避免 Pi 流式重放导致重复 */
const forwardedToolStarts = new Set<string>()
/** 各委派最近一次 assistant 文本转发的毫秒时间戳（节流用） */
const lastAssistantForwardAt = new Map<string, number>()
/** assistant 文本节流窗口（ms）：同一委派在窗口内合并为一次转发 */
const ASSISTANT_FORWARD_THROTTLE_MS = 250

/** 从工具输入中提取简短摘要（用于子 Agent 活动展示） */
function summarizeToolInput(toolName: string, input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined
  const priorityKeys = ['command', 'query', 'pattern', 'path', 'file_path', 'url', 'prompt', 'subject', 'description']
  for (const key of priorityKeys) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim().length > 80 ? `${value.trim().slice(0, 80)}…` : value.trim()
    }
  }
  const first = Object.values(input).find((v): v is string => typeof v === 'string' && v.trim().length > 0)
  if (first) return first.trim().length > 80 ? `${first.trim().slice(0, 80)}…` : first.trim()
  return undefined
}

/** 从子 Agent assistant 消息中提取文本内容（流式片段） */
function extractAssistantText(msg: unknown): string | undefined {
  const m = msg as { message?: { content?: Array<{ type?: string; text?: string }> }; content?: Array<{ type?: string; text?: string }> }
  const blocks = m.message?.content ?? m.content
  if (!Array.isArray(blocks)) return undefined
  const text = blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim()
  return text || undefined
}
// Pi 的 provider/retry 流可能重放同一个 tool call；委派会创建真实会话，必须幂等。
const piDelegateAgentCalls = createToolCallIdempotencyCache<PiDelegationToolResult>()
const piDelegateAgentsCalls = createToolCallIdempotencyCache<PiBatchDelegationResult>()

// ===== 阻塞事件追踪（Level 1: Blocked Event Bubbling） =====

interface BlockedEvent {
  id: string
  delegationId: string
  childSessionId: string
  type: 'ask_user' | 'permission'
  askUserRequestId?: string
  askUserQuestions?: Array<{ question: string; header?: string; options: Array<{ label: string; description?: string }> }>
  permissionRequestId?: string
  permissionToolName?: string
  resolved: boolean
  createdAt: number
}

const blockedEvents = new Map<string, BlockedEvent>()

let _eventBusRegistered = false
let _eventBusRef: import('./agent-event-bus').AgentEventBus | null = null

export function registerCollaborationEventBus(eventBus: import('./agent-event-bus').AgentEventBus): void {
  if (_eventBusRegistered) return
  _eventBusRegistered = true
  _eventBusRef = eventBus

  eventBus.on((sessionId: string, payload: AgentStreamPayload) => {
    // O(1) 索引查找（避免每次事件全量扫描 delegations Map）
    const delegationId = delegationByChildSession.get(sessionId)
    const record = delegationId ? delegations.get(delegationId) : undefined
    if (!record || record.status !== 'running') return

    // 子 Agent 工具活动转发：子会话的 SDK 消息（tool_use/tool_result/assistant 文本）
    // 转成父会话的 delegation_progress 事件，让父会话对话里实时看到子 Agent 执行过程
    if (payload.kind === 'sdk_message') {
      const msg = payload.message
      const msgContent = (msg as unknown as { message?: { content?: unknown[] } }).message?.content
      if (msg.type === 'assistant') {
        const content = Array.isArray(msgContent) ? msgContent : []
        for (const block of content) {
          const typed = block as { type?: string; id?: string; name?: string; input?: Record<string, unknown> }
          if (typed.type === 'tool_use' && typed.id) {
            // 去重：Pi 流式可能先 partial 后完整重放同一 tool_use
            const dedupKey = `${record.delegationId}:${typed.id}`
            if (forwardedToolStarts.has(dedupKey)) continue
            forwardedToolStarts.add(dedupKey)
            console.log(`[协作] 转发 tool_start: ${typed.name} (parentToolUseId=${record.parentToolUseId})`)
            eventBus.emit(record.parentSessionId, {
              kind: 'guru_event',
              event: {
                type: 'delegation_progress' as const,
                delegationId: record.delegationId,
                toolUseId: typed.id,
                phase: 'tool_start' as const,
                toolName: typed.name,
                brief: summarizeToolInput(typed.name ?? '工具', typed.input),
                title: record.title,
                role: record.role,
                parentToolUseId: record.parentToolUseId,
              } as import('@guru/shared').GuruEvent,
            })
          }
        }
        const text = extractAssistantText(msg)
        if (text) {
          // 节流：同一委派 250ms 内合并文本转发，避免流式帧刷屏
          const now = Date.now()
          const lastAt = lastAssistantForwardAt.get(record.delegationId) ?? 0
          if (now - lastAt >= ASSISTANT_FORWARD_THROTTLE_MS) {
            lastAssistantForwardAt.set(record.delegationId, now)
            eventBus.emit(record.parentSessionId, {
              kind: 'guru_event',
              event: {
                type: 'delegation_progress' as const,
                delegationId: record.delegationId,
                phase: 'assistant' as const,
                text,
                title: record.title,
                role: record.role,
                parentToolUseId: record.parentToolUseId,
              } as import('@guru/shared').GuruEvent,
            })
          }
        }
      }
      if (msg.type === 'user') {
        const content = Array.isArray(msgContent) ? msgContent : []
        for (const block of content) {
          const typed = block as { type?: string; tool_use_id?: string; is_error?: boolean; content?: unknown }
          if (typed.type === 'tool_result') {
            // 提取工具输出文本（供渲染层展开查看）
            let resultText: string | undefined
            if (typeof typed.content === 'string') {
              resultText = typed.content
            } else if (Array.isArray(typed.content)) {
              resultText = (typed.content as Array<{ type?: string; text?: string }>)
                .filter((c) => c.type === 'text' && typeof c.text === 'string')
                .map((c) => c.text)
                .join('\n')
            }
            eventBus.emit(record.parentSessionId, {
              kind: 'guru_event',
              event: {
                type: 'delegation_progress' as const,
                delegationId: record.delegationId,
                toolUseId: typed.tool_use_id,
                phase: 'tool_result' as const,
                isError: typed.is_error === true,
                result: resultText && resultText.length > 8000 ? `${resultText.slice(0, 8000)}…` : resultText,
                title: record.title,
                role: record.role,
                parentToolUseId: record.parentToolUseId,
              } as import('@guru/shared').GuruEvent,
            })
          }
        }
      }
      return
    }

    if (payload.kind !== 'guru_event') return

    const event = payload.event
    if (event.type === 'ask_user_request') {
      const req = event.request as AskUserRequest
      const blocked: BlockedEvent = {
        id: randomUUID(),
        delegationId: record.delegationId,
        childSessionId: sessionId,
        type: 'ask_user',
        askUserRequestId: req.requestId,
        askUserQuestions: req.questions.map((q) => ({
          question: q.question,
          header: q.header,
          options: q.options.map((o) => ({ label: o.label, description: o.description })),
        })),
        resolved: false,
        createdAt: Date.now(),
      }
      blockedEvents.set(blocked.id, blocked)

      eventBus.emit(record.parentSessionId, {
        kind: 'guru_event',
        event: {
          type: 'delegation_blocked' as const,
          delegationId: record.delegationId,
          blockedEvent: blocked,
        } as import('@guru/shared').GuruEvent,
      })
    }

    if (event.type === 'permission_request') {
      const req = event.request as PermissionRequest
      const blocked: BlockedEvent = {
        id: randomUUID(),
        delegationId: record.delegationId,
        childSessionId: sessionId,
        type: 'permission',
        permissionRequestId: req.requestId,
        permissionToolName: req.toolName,
        resolved: false,
        createdAt: Date.now(),
      }
      blockedEvents.set(blocked.id, blocked)

      eventBus.emit(record.parentSessionId, {
        kind: 'guru_event',
        event: {
          type: 'delegation_blocked' as const,
          delegationId: record.delegationId,
          blockedEvent: blocked,
        } as import('@guru/shared').GuruEvent,
      })
    }

    if (event.type === 'ask_user_resolved' || event.type === 'permission_resolved') {
      const requestId = 'requestId' in event ? (event as { requestId: string }).requestId : undefined
      if (requestId) {
        for (const be of blockedEvents.values()) {
          if (be.resolved) continue
          if (be.askUserRequestId === requestId || be.permissionRequestId === requestId) {
            blockedEvents.delete(be.id)
            break
          }
        }
      }
    }
  })

  console.log('[协作工具] EventBus 阻塞事件监听已注册')
}

function getPendingBlockedEvents(delegationId: string): BlockedEvent[] {
  return Array.from(blockedEvents.values()).filter((be) => {
    if (be.delegationId !== delegationId || be.resolved) return false
    // 去活校验：用户可能已通过主界面直接响应（ipc 路径不经过 eventBus），
    // 此时服务端 pending 已清除，blockedEvent 视为幽灵，直接清理
    if (be.type === 'ask_user' && be.askUserRequestId) {
      const { askUserService } = require('./agent-ask-user-service') as typeof import('./agent-ask-user-service')
      const stillPending = askUserService.getPendingRequests?.().some((r) => r.requestId === be.askUserRequestId)
      if (!stillPending) {
        blockedEvents.delete(be.id)
        return false
      }
    }
    if (be.type === 'permission' && be.permissionRequestId) {
      const { permissionService } = require('./agent-permission-service') as typeof import('./agent-permission-service')
      const stillPending = permissionService.getPendingRequests().some((r) => r.requestId === be.permissionRequestId)
      if (!stillPending) {
        blockedEvents.delete(be.id)
        return false
      }
    }
    return true
  })
}

function getBlockedEventById(blockedEventId: string): BlockedEvent | undefined {
  return blockedEvents.get(blockedEventId)
}

function deleteBlockedEventsForDelegation(delegationId: string): void {
  for (const [blockedEventId, blockedEvent] of blockedEvents) {
    if (blockedEvent.delegationId === delegationId) blockedEvents.delete(blockedEventId)
  }
}

/**
 * 清理内存中过多的已结束委派，避免 live Map 无界增长。
 * 仅清理 status !== 'running' 的记录；被清理项仍可通过持久化会话回查。
 */
function pruneFinishedDelegations(): void {
  const finished = Array.from(delegations.values()).filter((item) => item.status !== 'running')
  const excess = finished.length - MAX_RETAINED_FINISHED_DELEGATIONS
  if (excess <= 0) return
  finished
    .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
    .slice(0, excess)
    .forEach((item) => {
      delegations.delete(item.delegationId)
      deleteBlockedEventsForDelegation(item.delegationId)
    })
}

function jsonResult(payload: unknown): CollaborationToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  }
}

function normalizeTitle(input: string | undefined, fallback: string): string {
  const trimmed = input?.trim()
  if (trimmed) return trimmed.slice(0, 80)
  return fallback.slice(0, 80)
}

function truncateText(text: string, limit: number): string {
  return text.length <= limit
    ? text
    : `${text.slice(0, limit)}\n\n[内容过长，已截断 ${text.length - limit} 字符]`
}

function assertNonBlank(value: string | undefined, field: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new Error(`${field} 不能为空`)
  }
  return trimmed
}

interface DelegateAgentArgs {
  title?: string
  role?: AgentDelegationRole
  task: string
  expectedOutput?: string
  permissionMode?: GuruPermissionMode
  modelId?: string
}

interface StartDelegationResult {
  record: DelegationRecord
  effectivePermissionMode: GuruPermissionMode
  effectiveModelId?: string
}

interface PiDelegationToolResult {
  delegationId: string
  effectivePermissionMode: GuruPermissionMode
  effectiveModelId?: string
}

interface PiBatchDelegationResult {
  created: PiDelegationToolResult[]
  failures: Array<{ index: number; title?: string; error: string }>
}

function getRunningDelegationCount(parentSessionId: string): number {
  return Array.from(delegations.values())
    .filter((item) => item.parentSessionId === parentSessionId && item.status === 'running')
    .length
}

function createDelegationCompletion(): Pick<DelegationRecord, 'completion' | 'resolveCompletion'> {
  let resolveCompletion: () => void = () => {}
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve
  })
  return { completion, resolveCompletion }
}

function assertCanCreateDelegation(
  ctx: CollaborationToolContext,
  requestedCount = 1,
): AgentSessionMeta | undefined {
  const parent = getAgentSessionMeta(ctx.sessionId)
  const delegationDepth = parent?.delegationDepth ?? 0

  if (ctx.triggeredBy === 'delegation' || delegationDepth > 0) {
    throw new Error('协作子会话不能继续创建新的子会话')
  }

  const runningCount = getRunningDelegationCount(ctx.sessionId)
  if (runningCount + requestedCount > MAX_RUNNING_DELEGATIONS_PER_PARENT) {
    throw new Error(`当前父会话已有 ${runningCount} 个运行中的协作子会话，最多允许 ${MAX_RUNNING_DELEGATIONS_PER_PARENT} 个`)
  }

  if (!ctx.channelId) {
    throw new Error('创建协作子会话需要可用的 channelId')
  }
  if (!ctx.workspaceId) {
    throw new Error('创建协作子会话需要绑定工作区')
  }

  return parent
}

function extractTextFromSdkMessage(message: SDKMessage): string[] {
  const record = message as Record<string, unknown>
  if (record.type !== 'assistant') return []

  const outerMessage = record.message
  if (!outerMessage || typeof outerMessage !== 'object') return []

  const content = (outerMessage as Record<string, unknown>).content
  if (!Array.isArray(content)) return []

  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const blockRecord = block as Record<string, unknown>
    if (blockRecord.type === 'text' && typeof blockRecord.text === 'string') {
      parts.push(blockRecord.text)
    }
  }
  return parts
}

function summarizeChildResult(childSessionId: string, messages?: AgentMessage[]): string {
  const lastAssistant = [...(messages ?? [])]
    .reverse()
    .find((message) => message.role === 'assistant' && message.content.trim().length > 0)
  if (lastAssistant) return truncateText(lastAssistant.content.trim(), RESULT_SUMMARY_CHAR_LIMIT)

  const sdkMessages = getAgentSessionSDKMessages(childSessionId)
  const sdkTexts: string[] = []
  for (const message of sdkMessages) {
    sdkTexts.push(...extractTextFromSdkMessage(message))
  }
  const text = sdkTexts.join('\n\n').trim()
  if (text) return truncateText(text, RESULT_SUMMARY_CHAR_LIMIT)

  return '子会话已结束，但未找到可摘要的 assistant 文本。请打开子会话查看完整记录。'
}

function markDelegationFinished(
  record: DelegationRecord,
  status: AgentDelegationStatus,
  fields: { error?: string; resultSummary?: string } = {},
): void {
  if (record.status !== 'running') return
  record.status = status
  record.completedAt = Date.now()
  record.error = fields.error
  record.resultSummary = fields.resultSummary
  // 委派终态事件：渲染层据此在委派工具行显示最终摘要（报告 Markdown）
  try {
    if (_eventBusRef && record.parentToolUseId) {
      _eventBusRef.emit(record.parentSessionId, {
        kind: 'guru_event',
        event: {
          type: 'delegation_progress' as const,
          delegationId: record.delegationId,
          phase: 'final' as const,
          isError: status !== 'completed',
          result: fields.resultSummary,
          title: record.title,
          role: record.role,
          parentToolUseId: record.parentToolUseId,
        } as import('@guru/shared').GuruEvent,
      })
    }
  } catch {
    // 转发失败不影响状态机
  }
  try {
    // 子会话可能已被用户删除（updateAgentSessionMeta 会抛"会话不存在"）：
    // 不能让该异常阻断 resolveCompletion，否则父会话 wait_for_delegations 会永久挂起
    updateAgentSessionMeta(record.childSessionId, { delegationStatus: status })
  } catch {
    // 会话已删除或持久化失败：仅记日志，状态机照常收敛
  }
  deleteBlockedEventsForDelegation(record.delegationId)
  record.resolveCompletion()
}

function getDelegationSummary(record: DelegationRecord): Record<string, unknown> {
  return {
    delegationId: record.delegationId,
    parentSessionId: record.parentSessionId,
    childSessionId: record.childSessionId,
    channelId: record.channelId,
    modelId: record.modelId,
    title: record.title,
    role: record.role,
    goal: record.goal,
    permissionMode: record.permissionMode,
    status: record.status,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    error: record.error,
    resultSummary: record.resultSummary,
    pendingBlockedEvents: getPendingBlockedEvents(record.delegationId),
  }
}

function listKnownDelegations(parentSessionId: string): Array<Record<string, unknown>> {
  const live = Array.from(delegations.values())
    .filter((item) => item.parentSessionId === parentSessionId)
    .map(getDelegationSummary)

  const liveIds = new Set(live.map((item) => item.delegationId))
  const persisted = listAgentSessions()
    .filter((session) => session.parentSessionId === parentSessionId && session.sourceDelegationId && !liveIds.has(session.sourceDelegationId))
    .map((session) => {
      // 重启后遗留 running → interrupted
      const status = session.delegationStatus === 'running' ? 'interrupted' : session.delegationStatus
      return {
        delegationId: session.sourceDelegationId,
        parentSessionId,
        childSessionId: session.id,
        channelId: session.channelId,
        modelId: session.modelId,
        title: session.title,
        role: session.delegationRole,
        goal: session.delegationGoal,
        permissionMode: session.permissionMode,
        status,
        startedAt: session.createdAt,
        completedAt: session.delegationStatus === 'running' ? undefined : session.updatedAt,
      }
    })

  return [...live, ...persisted]
}

function getDelegationResult(parentSessionId: string, delegationId: string): Record<string, unknown> {
  const live = delegations.get(delegationId)
  if (live) {
    if (live.parentSessionId !== parentSessionId) {
      throw new Error(`委派不属于当前父会话: ${delegationId}`)
    }
    return getDelegationSummary(live)
  }

  const session = getPersistedDelegationSession(parentSessionId, delegationId)
  if (!session) {
    throw new Error(`未找到当前会话下的委派: ${delegationId}`)
  }

  // 应用重启后遗留的 running 委派实际已中断：归一化为 interrupted，避免父会话看到"永远 running"的幽灵委派
  const effectiveStatus = session.delegationStatus === 'running' ? 'interrupted' : session.delegationStatus

  const resultSummary = effectiveStatus
    ? summarizeChildResult(session.id)
    : undefined

  return {
    delegationId,
    parentSessionId: session.parentSessionId ?? parentSessionId,
    childSessionId: session.id,
    channelId: session.channelId,
    modelId: session.modelId,
    title: session.title,
    role: session.delegationRole,
    goal: session.delegationGoal,
    permissionMode: session.permissionMode,
    status: effectiveStatus,
    startedAt: session.createdAt,
    completedAt: session.delegationStatus === 'running' ? undefined : session.updatedAt,
    resultSummary,
  }
}

function findPersistedDelegationSessions(delegationId: string): AgentSessionMeta[] {
  return listAgentSessions()
    .filter((item) => item.sourceDelegationId === delegationId)
}

function getPersistedDelegationSession(parentSessionId: string, delegationId: string): AgentSessionMeta | undefined {
  const sessions = findPersistedDelegationSessions(delegationId)
  const scoped = sessions.find((item) => item.parentSessionId === parentSessionId)
  if (scoped) return scoped

  // 应用重启、恢复或旧数据修复后，父会话上下文可能暂时不完整。
  // delegationId 本身是 UUID；当全局只有唯一命中时，允许用它恢复，避免误报“当前会话下未找到”。
  // 但只有该会话未记录父会话、或父会话与当前一致时才接受，避免凭 UUID 跨父会话误恢复他人的委派。
  if (sessions.length !== 1) return undefined
  const unique = sessions[0]
  if (!unique) return undefined
  if (unique.parentSessionId == null || unique.parentSessionId === parentSessionId) {
    return unique
  }
  return undefined
}

function recoverDelegationRecordFromSession(
  parentSessionId: string,
  delegationId: string,
  session: AgentSessionMeta,
  fallbackPermissionMode: GuruPermissionMode | undefined,
  fallbackChannelId: string,
  fallbackModelId: string | undefined,
): DelegationRecord {
  const state = buildRecoveredDelegationState({
    // 与 getDelegationResult 保持一致：优先信任持久化记录里的父会话归属，
    // 仅在缺失时回落到当前会话上下文，避免两条恢复路径对 owner 判断不一致。
    parentSessionId: session.parentSessionId ?? parentSessionId,
    delegationId,
    session,
    fallbackPermissionMode,
  })
  const completionHandle = createDelegationCompletion()
  const record: DelegationRecord = {
    ...state,
    channelId: session.channelId ?? fallbackChannelId,
    modelId: session.modelId ?? fallbackModelId,
    ...completionHandle,
  }
  if (record.status !== 'running') {
    record.resolveCompletion()
    delegations.set(delegationId, record)
  }
  return record
}

function getDelegationRecordForContinuation(
  ctx: CollaborationToolContext,
  delegationId: string,
): DelegationRecord | undefined {
  const live = delegations.get(delegationId)
  if (live) {
    if (live.parentSessionId !== ctx.sessionId) {
      throw new Error(`委派不属于当前父会话: ${delegationId}`)
    }
    return live
  }

  const session = getPersistedDelegationSession(ctx.sessionId, delegationId)
  if (!session) return undefined
  return recoverDelegationRecordFromSession(ctx.sessionId, delegationId, session, ctx.permissionMode, ctx.channelId, ctx.modelId)
}

interface WaitResolution {
  /** 仍在内存中、需要实际等待的委派 */
  liveRecords: DelegationRecord[]
  /** 不在内存、但持久化记录已是终态的委派（如应用重启后的遗留委派） */
  settled: Array<Record<string, unknown>>
}

/**
 * 解析等待目标：内存中的进行中委派照常等待；
 * 不在内存的委派回退到持久化记录（重启后遗留），已终态则直接计入完成。
 * 两处都查不到才抛错。
 */
function resolveWaitTargets(ids: string[], parentSessionId: string): WaitResolution {
  const liveRecords: DelegationRecord[] = []
  const settled: Array<Record<string, unknown>> = []
  for (const id of ids) {
    const record = delegations.get(id)
    if (record) {
      if (record.parentSessionId !== parentSessionId) {
        throw new Error(`委派不属于当前父会话: ${id}`)
      }
      liveRecords.push(record)
      continue
    }
    // 不在内存：回退到持久化记录；getDelegationResult 在完全找不到时抛错
    settled.push(getDelegationResult(parentSessionId, id))
  }
  return { liveRecords, settled }
}

function getFinishedDelegationCount(records: DelegationRecord[]): number {
  return records.filter((record) => record.status !== 'running').length
}

async function waitForLiveRecords(
  records: DelegationRecord[],
  timeoutSeconds: number,
  liveTarget: number,
): Promise<'completed' | 'timeout'> {
  if (getFinishedDelegationCount(records) >= liveTarget) {
    return 'completed'
  }

  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      new Promise<'completed'>((resolve) => {
        const check = () => {
          if (getFinishedDelegationCount(records) >= liveTarget) {
            resolve('completed')
          }
        }
        for (const record of records) {
          if (record.status === 'running') {
            record.completion.then(check)
          }
        }
      }),
      new Promise<'timeout'>((resolve) => {
        timeout = setTimeout(() => resolve('timeout'), timeoutSeconds * 1000)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function getCurrentParentPermissionMode(
  parent: AgentSessionMeta | undefined,
  fallback: GuruPermissionMode | undefined,
): GuruPermissionMode | undefined {
  const latestParent = parent ? getAgentSessionMeta(parent.id) : undefined
  return latestParent?.permissionMode ?? parent?.permissionMode ?? fallback
}

function getAvailableAgentModels(ctx: CollaborationToolContext): Record<string, unknown> {
  const currentModelId = ctx.modelId?.trim() || undefined
  const summary = listEnabledAgentModelsForChannel(ctx.channelId, '读取协作子会话可用模型')
  return {
    channelId: summary.channelId,
    channelName: summary.channelName,
    provider: summary.provider,
    currentModelId,
    currentModelAvailable: currentModelId
      ? summary.models.some((model) => model.id === currentModelId)
      : false,
    models: summary.models.map((model) => ({
      ...model,
      current: model.id === currentModelId,
    })),
    modelCount: summary.models.length,
    note: summary.models.length > 0
      ? '创建协作子会话时，可从 models[].id 中选择 modelId；不传则继承 currentModelId。'
      : '当前渠道没有启用的 Agent 模型，请先在渠道设置中启用模型。',
  }
}

function stopDelegation(parentSessionId: string, delegationId: string): Record<string, unknown> {
  const record = delegations.get(delegationId)
  if (!record) {
    // 不在内存：可能是应用重启后的遗留委派。回退到持久化记录（完全找不到才抛错），无法主动停止
    return {
      delegation: getDelegationResult(parentSessionId, delegationId),
      stopped: false,
      note: '该委派不在当前运行内存中（可能因应用重启已中断），无法主动停止。',
    }
  }
  if (record.parentSessionId !== parentSessionId) {
    throw new Error(`未找到当前会话下的委派: ${delegationId}`)
  }
  if (record.status !== 'running') {
    return {
      delegation: getDelegationSummary(record),
      stopped: false,
    }
  }

  stopRegisteredAgent(record.childSessionId)
  markDelegationFinished(record, 'cancelled')
  return {
    delegation: getDelegationSummary(record),
    stopped: true,
  }
}

function startDelegation(
  ctx: CollaborationToolContext,
  parent: AgentSessionMeta | undefined,
  args: DelegateAgentArgs,
  parentToolUseId?: string,
): StartDelegationResult {
  const task = assertNonBlank(args.task, 'task')
  const delegationId = randomUUID()
  const role = args.role ?? 'custom'
  const title = normalizeTitle(args.title, `协作：${task}`)
  const goal = truncateText(task, DELEGATION_GOAL_CHAR_LIMIT)
  const parentPermissionMode = getCurrentParentPermissionMode(parent, ctx.permissionMode)
  const permissionMode = resolveDelegationPermissionMode(
    parentPermissionMode,
    args.permissionMode,
  )
  const effectiveModelId = args.modelId !== undefined
    ? assertEnabledModelForChannel({
        channelId: ctx.channelId,
        modelId: args.modelId,
        purpose: '创建协作子会话',
      })
    : ctx.modelId?.trim() || undefined

  const { completion, resolveCompletion } = createDelegationCompletion()

  const child = createAgentSession(title, ctx.channelId, ctx.workspaceId, effectiveModelId)
  const rootSessionId = parent?.rootSessionId ?? parent?.id ?? ctx.sessionId
  // 继承父会话的 craft Project，避免子会话掉出项目子分组、丢失项目 workingDirectory / prompt 上下文
  updateAgentSessionMeta(child.id, {
    parentSessionId: ctx.sessionId,
    rootSessionId,
    sourceDelegationId: delegationId,
    sourceAutomationId: parent?.sourceAutomationId,
    delegationRole: role,
    delegationStatus: 'running',
    delegationDepth: (parent?.delegationDepth ?? 0) + 1,
    delegationGoal: goal,
    permissionMode,
    ...(parent?.projectId ? { projectId: parent.projectId } : {}),
    ...(parent?.workingDirectory ? { workingDirectory: parent.workingDirectory } : {}),
  })

  const record: DelegationRecord = {
    delegationId,
    parentSessionId: ctx.sessionId,
    childSessionId: child.id,
    channelId: ctx.channelId,
    modelId: effectiveModelId,
    parentToolUseId,
    title,
    role,
    goal,
    permissionMode,
    status: 'running',
    startedAt: Date.now(),
    completion,
    resolveCompletion,
  }
  delegations.set(delegationId, record)
  delegationByChildSession.set(child.id, delegationId)
  pruneFinishedDelegations()

  const prompt = buildDelegationPrompt({
    parentSessionId: ctx.sessionId,
    delegationId,
    role,
    task,
    expectedOutput: args.expectedOutput,
  })

  runRegisteredHeadlessAgent(
    {
      sessionId: child.id,
      userMessage: prompt,
      channelId: ctx.channelId,
      modelId: effectiveModelId,
      workspaceId: ctx.workspaceId,
      permissionModeOverride: permissionMode,
      triggeredBy: 'delegation',
      startedAt: record.startedAt,
    },
    {
      source: 'delegation',
      originSessionId: ctx.sessionId,
      onError: (error) => {
        markDelegationFinished(record, 'failed', { error })
      },
      onComplete: () => {
        // upstream #1627 起 complete 不再经回调传输完整消息；summarizeChildResult 内部有磁盘兑底
        if (record.status !== 'running') return
        const resultSummary = summarizeChildResult(child.id)
        markDelegationFinished(record, 'completed', { resultSummary })
      },
      onTitleUpdated: (updatedTitle) => {
        record.title = updatedTitle
        try { updateAgentSessionMeta(record.childSessionId, { title: updatedTitle }) } catch { /* 持久化失败不影响运行 */ }
      },
    },
  ).catch((error: unknown) => {
    markDelegationFinished(record, 'failed', {
      error: error instanceof Error ? error.message : '未知错误',
    })
  })

  return { record, effectivePermissionMode: permissionMode, effectiveModelId }
}

function buildCollaborationSchemas(z: ZodModule['z']) {
  const nonBlankString = z.string().trim().min(1)
  const role = z.enum(['explore', 'research', 'implement', 'review', 'custom'])
  const permissionMode = z.enum(['plan', 'bypassPermissions'])
  const delegateItem = z.object({
    title: z.string().optional().describe('子会话标题，简短说明子任务'),
    role: role.optional().describe('子任务角色：explore/research/implement/review/custom'),
    task: nonBlankString.describe('发送给子 Agent 的完整任务说明，必须自包含必要上下文'),
    expectedOutput: z.string().optional().describe('希望子 Agent 最终返回的格式或要点'),
    permissionMode: permissionMode.optional().describe('子会话权限模式；不能高于父会话权限'),
    modelId: nonBlankString.optional().describe('可选目标模型 ID；必须属于父会话当前渠道且已启用。不传则继承父会话当前模型'),
  })
  return {
    availableModels: {},
    delegate: {
      title: z.string().optional().describe('子会话标题，简短说明子任务'),
      role: role.optional().describe('子任务角色：explore/research/implement/review/custom'),
      task: nonBlankString.describe('发送给子 Agent 的完整任务说明，必须自包含必要上下文'),
      expectedOutput: z.string().optional().describe('希望子 Agent 最终返回的格式或要点'),
      permissionMode: permissionMode.optional().describe('子会话权限模式；不能高于父会话权限'),
      modelId: nonBlankString.optional().describe('可选目标模型 ID；必须属于父会话当前渠道且已启用。不传则继承父会话当前模型'),
    },
    delegateBatch: {
      sharedContext: z.string().optional().describe('批量子任务共用背景，会自动拼接到每个子任务前'),
      items: z.array(delegateItem).min(1).max(MAX_RUNNING_DELEGATIONS_PER_PARENT).describe('要创建的子会话列表，最多 50 个'),
    },
    wait: {
      delegationIds: z.array(z.string()).optional().describe('要等待的委派 ID；不传则等待当前父会话当前运行中的全部委派'),
      mode: z.enum(['all', 'any']).optional().describe('等待模式：all 等全部完成，any 等至少 minCompleted 个完成'),
      minCompleted: z.number().int().min(1).max(MAX_RUNNING_DELEGATIONS_PER_PARENT).optional().describe('mode=any 时至少等待完成的数量，默认 1'),
      timeoutSeconds: z.number().int().min(1).max(MAX_DELEGATION_WAIT_SECONDS).optional().describe('最长等待秒数，默认 3600，最大 7200'),
    },
    list: {
      includeCompleted: z.boolean().optional().describe('是否包含已完成委派，默认 true'),
    },
    results: {
      delegationIds: z.array(z.string()).min(1).max(MAX_RUNNING_DELEGATIONS_PER_PARENT).describe('要读取结果的委派 ID 列表'),
    },
    stop: {
      delegationId: z.string().describe('要停止的委派 ID'),
    },
    stopBatch: {
      delegationIds: z.array(z.string()).min(1).max(MAX_RUNNING_DELEGATIONS_PER_PARENT).describe('要停止的委派 ID 列表'),
    },
    answer: {
      delegationId: nonBlankString.describe('子会话所属的委派 ID'),
      blockedEventId: nonBlankString.describe('要回答的阻塞事件 ID（从 delegation 的 pendingBlockedEvents 中获取）'),
      answers: z.record(z.string(), z.string()).optional().describe('AskUserQuestion 的回答（问题文本 → 答案文本）'),
      permissionBehavior: z.enum(['allow', 'deny']).optional().describe('Permission 请求的回复行为，默认 allow'),
    },
    continueD: {
      delegationId: nonBlankString.describe('要继续操作的委派 ID（必须是已完成/已失败/已取消状态）'),
      message: nonBlankString.describe('追加给子 Agent 的后续指令'),
    },
  }
}

/**
 * 为 Pi runtime 构建协作会话工具定义。
 * 复用同一份内部状态（delegations Map、blocked events 等），
 * 只是用 Pi SDK 的 defineTool() + TypeBox schema 包装。
 */
export function buildPiCollaborationTools(
  sdk: typeof import('@earendil-works/pi-coding-agent'),
  ctx: CollaborationToolContext,
): unknown[] {
  const { Type } = require('typebox') as typeof import('typebox')

  const roleType = Type.Optional(Type.Union([
    Type.Literal('explore'),
    Type.Literal('research'),
    Type.Literal('implement'),
    Type.Literal('review'),
    Type.Literal('custom'),
  ], { description: '子任务角色' }))

  const delegateItemType = Type.Object({
    title: Type.Optional(Type.String({ description: '子会话标题' })),
    role: roleType,
    task: Type.String({ description: '发送给子 Agent 的完整任务说明' }),
    expectedOutput: Type.Optional(Type.String({ description: '希望子 Agent 最终返回的格式或要点' })),
    modelId: Type.Optional(Type.String({ description: '可选目标模型 ID' })),
  })

  function piJsonResult(payload: unknown): { content: Array<{ type: 'text'; text: string }>; details: unknown } {
    return {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      details: payload,
    }
  }

  return [
    sdk.defineTool({
      name: 'mcp__collaboration__list_available_agent_models',
      label: '列出可用模型',
      description: '列出当前父会话渠道下已启用、可用于协作子 Agent 的模型。需要给 delegate_agent/delegate_agents 指定 modelId 前应先调用此工具。',
      parameters: Type.Object({}),
      async execute() {
        return piJsonResult(getAvailableAgentModels(ctx))
      },
    }),
    sdk.defineTool({
      name: 'mcp__collaboration__delegate_agent',
      label: '委派子 Agent',
      description: '创建一个真实可见的 Guru 协作子 Agent 会话来并行处理独立子任务。只用于长耗时、可并行、需要追踪的任务。委派只表示子会话已启动，不表示任务完成或结果已回传：若本轮回复、下一步决策或交付依赖该子任务，主会话必须在回复前用返回的 delegationId 调用 wait_for_delegations 收敛结果；只有仍有完全独立的工作时才可先继续推进。',
      parameters: Type.Object({
        title: Type.Optional(Type.String({ description: '子会话标题' })),
        role: roleType,
        task: Type.String({ description: '发送给子 Agent 的完整任务说明，必须自包含必要上下文' }),
        expectedOutput: Type.Optional(Type.String({ description: '希望子 Agent 最终返回的格式或要点' })),
        modelId: Type.Optional(Type.String({ description: '可选目标模型 ID' })),
      }),
      async execute(toolCallId: string, params: unknown) {
        const args = params as DelegateAgentArgs
        const result = piDelegateAgentCalls.getOrCreate(ctx.sessionId, toolCallId, () => {
          const parent = assertCanCreateDelegation(ctx)
          const created = startDelegation(ctx, parent, args, toolCallId)
          return {
            delegationId: created.record.delegationId,
            effectivePermissionMode: created.effectivePermissionMode,
            effectiveModelId: created.effectiveModelId,
          }
        })
        return piJsonResult({
          delegation: getDelegationResult(ctx.sessionId, result.delegationId),
          effectivePermissionMode: result.effectivePermissionMode,
          effectiveModelId: result.effectiveModelId,
          note: '子会话已启动，尚未完成或回传结果。记录 delegationId；如果本轮回复、决策或交付依赖它，必须在回复前调用 wait_for_delegations 收敛。仅在父会话还有完全独立的工作时才继续推进。',
        })
      },
    }),
    sdk.defineTool({
      name: 'mcp__collaboration__delegate_agents',
      label: '批量委派子 Agent',
      description: '批量创建多个真实可见的 Guru 协作子 Agent 会话。适合把同一大任务拆成多片并行处理。创建成功只表示各子会话已启动，不表示批次已完成：若本轮需要基于任一或全部子任务交付、判断或回复，主会话必须在回复前用返回的 delegationIds 调用 wait_for_delegations（需要完整结论时用 mode=all）；仅可在等待前推进完全独立的主线。',
      parameters: Type.Object({
        sharedContext: Type.Optional(Type.String({ description: '批量子任务共用背景' })),
        items: Type.Array(delegateItemType, { description: '要创建的子会话列表，最多 50 个' }),
      }),
      async execute(toolCallId: string, params: unknown) {
        const args = params as { sharedContext?: string; items: DelegateAgentArgs[] }
        const batch = piDelegateAgentsCalls.getOrCreate(ctx.sessionId, toolCallId, () => {
          const parent = assertCanCreateDelegation(ctx, args.items.length)
          const created: PiDelegationToolResult[] = []
          const failures: Array<{ index: number; title?: string; error: string }> = []
          args.items.forEach((item, index) => {
            try {
              const started = startDelegation(ctx, parent, {
                ...item,
                task: buildDelegationTaskWithSharedContext({
                  sharedContext: args.sharedContext,
                  task: item.task,
                }),
              }, toolCallId)
              created.push({
                delegationId: started.record.delegationId,
                effectivePermissionMode: started.effectivePermissionMode,
                effectiveModelId: started.effectiveModelId,
              })
            } catch (error) {
              failures.push({
                index,
                title: item.title,
                error: error instanceof Error ? error.message : '未知错误',
              })
            }
          })
          return { created, failures }
        })
        return piJsonResult({
          delegations: batch.created.map((item) => getDelegationResult(ctx.sessionId, item.delegationId)),
          effectivePermissionModes: batch.created.map((item) => ({
            delegationId: item.delegationId,
            permissionMode: item.effectivePermissionMode,
          })),
          effectiveModels: batch.created.map((item) => ({
            delegationId: item.delegationId,
            modelId: item.effectiveModelId,
          })),
          failures: batch.failures,
          createdCount: batch.created.length,
          failedCount: batch.failures.length,
          maxRunningDelegations: MAX_RUNNING_DELEGATIONS_PER_PARENT,
        })
      },
    }),
    sdk.defineTool({
      name: 'mcp__collaboration__wait_for_delegations',
      label: '等待子会话完成',
      description: '父会话用于收敛子会话结果的等待屏障：等待指定的 Guru 协作子会话完成，并返回结构化结果摘要。只要本轮回复、决策或交付依赖已委派任务，主会话必须在回复前调用本工具，不能只因 delegate_agent/delegate_agents 已返回就宣称完成；需要全部结果时传入所有 delegationIds 并使用 mode=all，需要部分早期结果时才使用 mode=any。若返回 timeout 或仍有 running 委派，必须如实说明未收敛状态，不能把未完成任务当作已有结果。',
      parameters: Type.Object({
        delegationIds: Type.Optional(Type.Array(Type.String(), { description: '要等待的委派 ID' })),
        mode: Type.Optional(Type.Union([Type.Literal('all'), Type.Literal('any')])),
        minCompleted: Type.Optional(Type.Number({ description: 'mode=any 时至少等待完成的数量，默认 1' })),
        timeoutSeconds: Type.Optional(Type.Number({ description: '最长等待秒数，默认 3600；最大 7200' })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { delegationIds?: string[]; mode?: 'all' | 'any'; minCompleted?: number; timeoutSeconds?: number }
        const ids = args.delegationIds?.length
          ? args.delegationIds
          : Array.from(delegations.values())
            .filter((item) => item.parentSessionId === ctx.sessionId && item.status === 'running')
            .map((item) => item.delegationId)
        const { liveRecords, settled } = resolveWaitTargets(ids, ctx.sessionId)
        const totalTargets = liveRecords.length + settled.length
        if (totalTargets === 0) {
          return piJsonResult({ delegations: [], note: '没有找到可等待的协作委派' })
        }
        const mode = args.mode ?? 'all'
        const minCompleted = args.minCompleted ?? 1
        const timeoutSeconds = Math.min(
          args.timeoutSeconds ?? DEFAULT_DELEGATION_WAIT_SECONDS,
          MAX_DELEGATION_WAIT_SECONDS,
        )
        const targetCompleted = mode === 'all' ? totalTargets : Math.max(1, Math.min(minCompleted, totalTargets))
        const liveTarget = Math.max(0, targetCompleted - settled.length)
        const waitResult = liveRecords.length > 0
          ? await waitForLiveRecords(liveRecords, timeoutSeconds, liveTarget)
          : 'completed'
        const allDelegations = [...liveRecords.map(getDelegationSummary), ...settled]
        return piJsonResult({
          status: waitResult,
          mode,
          completedCount: allDelegations.filter((item) => item.status !== 'running').length,
          runningCount: allDelegations.filter((item) => item.status === 'running').length,
          delegations: allDelegations,
        })
      },
    }),
    sdk.defineTool({
      name: 'mcp__collaboration__list_delegations',
      label: '列出协作子会话',
      description: '列出当前父会话创建的 Guru 协作子会话及状态。',
      parameters: Type.Object({
        includeCompleted: Type.Optional(Type.Boolean({ description: '是否包含已完成委派，默认 true' })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { includeCompleted?: boolean }
        const items = listKnownDelegations(ctx.sessionId)
        const delegationsResult = args.includeCompleted === false
          ? items.filter((item) => item.status === 'running')
          : items
        return piJsonResult({
          maxRunningDelegations: MAX_RUNNING_DELEGATIONS_PER_PARENT,
          runningCount: delegationsResult.filter((item) => item.status === 'running').length,
          delegations: delegationsResult,
        })
      },
    }),
    sdk.defineTool({
      name: 'mcp__collaboration__get_delegation_results',
      label: '读取子会话结果',
      description: '按委派 ID 读取一个或多个 Guru 协作子会话的结果摘要。',
      parameters: Type.Object({
        delegationIds: Type.Array(Type.String(), { description: '要读取结果的委派 ID 列表' }),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { delegationIds: string[] }
        return piJsonResult({
          delegations: args.delegationIds.map((delegationId) => getDelegationResult(ctx.sessionId, delegationId)),
        })
      },
    }),
    sdk.defineTool({
      name: 'mcp__collaboration__stop_delegation',
      label: '停止子会话',
      description: '停止一个正在运行的 Guru 协作子会话。',
      parameters: Type.Object({
        delegationId: Type.String({ description: '要停止的委派 ID' }),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { delegationId: string }
        return piJsonResult(stopDelegation(ctx.sessionId, args.delegationId))
      },
    }),
    sdk.defineTool({
      name: 'mcp__collaboration__stop_delegations',
      label: '批量停止子会话',
      description: '批量停止多个正在运行的 Guru 协作子会话。',
      parameters: Type.Object({
        delegationIds: Type.Array(Type.String(), { description: '要停止的委派 ID 列表' }),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { delegationIds: string[] }
        return piJsonResult({
          results: args.delegationIds.map((delegationId) => stopDelegation(ctx.sessionId, delegationId)),
        })
      },
    }),
    sdk.defineTool({
      name: 'mcp__collaboration__answer_delegation_question',
      label: '代答子会话问题',
      description: '代答协作子会话的阻塞问题或审批权限请求。从 delegation 的 pendingBlockedEvents 获取 blockedEventId。',
      parameters: Type.Object({
        delegationId: Type.String({ description: '子会话所属的委派 ID' }),
        blockedEventId: Type.String({ description: '要回答的阻塞事件 ID' }),
        answers: Type.Optional(Type.Record(Type.String(), Type.String(), { description: 'AskUserQuestion 的回答' })),
        permissionBehavior: Type.Optional(Type.Union([Type.Literal('allow'), Type.Literal('deny')])),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { delegationId: string; blockedEventId: string; answers?: Record<string, string>; permissionBehavior?: 'allow' | 'deny' }
        const blocked = getBlockedEventById(args.blockedEventId)
        if (!blocked) return piJsonResult({ answered: false, note: '该阻塞事件不存在或已被解决' })
        if (blocked.resolved) return piJsonResult({ answered: false, note: '该阻塞事件已被解决' })

        const record = delegations.get(blocked.delegationId)
        if (record && record.parentSessionId !== ctx.sessionId) {
          throw new Error(`委派不属于当前父会话: ${blocked.delegationId}`)
        }

        if (blocked.type === 'ask_user' && blocked.askUserRequestId) {
          const { askUserService } = await import('./agent-ask-user-service')
          const answers = args.answers ?? {}
          const sessionId = askUserService.respondToAskUser(blocked.askUserRequestId, answers)
          blocked.resolved = !!sessionId
          if (blocked.resolved && _eventBusRef) {
            _eventBusRef.emit(blocked.childSessionId, {
              kind: 'guru_event',
              event: { type: 'ask_user_resolved', requestId: blocked.askUserRequestId },
            })
          }
          if (blocked.resolved) blockedEvents.delete(blocked.id)
          return piJsonResult({ answered: blocked.resolved, type: 'ask_user' })
        }

        if (blocked.type === 'permission' && blocked.permissionRequestId) {
          const { permissionService } = await import('./agent-permission-service')
          const behavior = args.permissionBehavior ?? 'allow'
          const sessionId = permissionService.respondToPermission(blocked.permissionRequestId, behavior, false)
          blocked.resolved = !!sessionId
          if (blocked.resolved && _eventBusRef) {
            _eventBusRef.emit(blocked.childSessionId, {
              kind: 'guru_event',
              event: { type: 'permission_resolved', requestId: blocked.permissionRequestId, behavior },
            })
          }
          if (blocked.resolved) blockedEvents.delete(blocked.id)
          return piJsonResult({ answered: blocked.resolved, type: 'permission', behavior })
        }

        return piJsonResult({ answered: false, note: '无法匹配阻塞事件类型' })
      },
    }),
    sdk.defineTool({
      name: 'mcp__collaboration__continue_delegation',
      label: '追加后续指令',
      description: '向已完成、已失败、已取消或已中断的协作子会话追加后续指令。子会话保留完整上下文继续执行。',
      parameters: Type.Object({
        delegationId: Type.String({ description: '要继续操作的委派 ID' }),
        message: Type.String({ description: '追加给子 Agent 的后续指令' }),
      }),
      async execute(_toolCallId: string, params: unknown) {
        const args = params as { delegationId: string; message: string }
        const record = getDelegationRecordForContinuation(ctx, args.delegationId)
        if (!record) throw new Error(`未找到当前会话下的委派: ${args.delegationId}`)
        if (record.status === 'running') {
          throw new Error(`委派正在运行中，无法追加指令: ${args.delegationId}`)
        }

        record.status = 'running'
        record.error = undefined
        record.resultSummary = undefined
        record.completedAt = undefined
        const completionHandle = createDelegationCompletion()
        record.completion = completionHandle.completion
        record.resolveCompletion = completionHandle.resolveCompletion

        updateAgentSessionMeta(record.childSessionId, { delegationStatus: 'running' })

        runRegisteredHeadlessAgent(
          {
            sessionId: record.childSessionId,
            userMessage: args.message,
            channelId: record.channelId,
            modelId: record.modelId,
            workspaceId: ctx.workspaceId,
            permissionModeOverride: record.permissionMode,
            triggeredBy: 'delegation',
            startedAt: Date.now(),
          },
          {
            source: 'delegation',
            originSessionId: ctx.sessionId,
            onError: (error) => {
              markDelegationFinished(record, 'failed', { error })
            },
            onComplete: () => {
              // upstream #1627 起 complete 不再经回调传输完整消息；summarizeChildResult 内部有磁盘兑底
              if (record.status !== 'running') return
              const resultSummary = summarizeChildResult(record.childSessionId)
              markDelegationFinished(record, 'completed', { resultSummary })
            },
            onTitleUpdated: (updatedTitle) => {
              record.title = updatedTitle
              try { updateAgentSessionMeta(record.childSessionId, { title: updatedTitle }) } catch { /* 持久化失败不影响运行 */ }
            },
          },
        ).catch((error: unknown) => {
          markDelegationFinished(record, 'failed', {
            error: error instanceof Error ? error.message : '未知错误',
          })
        })

        const timeout = new Promise<'timeout'>((resolve) => setTimeout(
          () => resolve('timeout'),
          DEFAULT_DELEGATION_WAIT_SECONDS * 1000,
        ))
        await Promise.race([record.completion, timeout])

        return piJsonResult({
          delegation: getDelegationSummary(record),
          note: record.status === 'running' ? '子会话仍在运行中（等待超时），可稍后用 wait_for_delegations 等待结果。' : undefined,
        })
      },
    }),
  ]
}
