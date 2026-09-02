/**
 * ContentBlock — 单个 SDKAssistantMessage 内容块渲染
 *
 * 支持三种内容块类型：
 * - text: 通过 MessageResponse 渲染 Markdown
 * - tool_use: 语义化短语行（如 "读取 foo.ts 第 10-60 行"），展开显示结构化结果
 * - thinking: 默认展开，左上角 "Thinking" 标签 + 虚线边框内容区
 */

import * as React from 'react'
import {
  ChevronRight,
  ChevronDown,
  ChevronUp,
  XCircle,
  Loader2,
  Brain,
  MessageSquareText,
  Terminal,
  Wrench,
  Bot,
  CheckCircle2,
  History,
} from 'lucide-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { thinkingExpandedAtom } from '@/atoms/chat-atoms'
import { activeSessionIdAtom } from '@/atoms/tab-atoms'
import { terminalPanelOpenMapAtom, terminalStateMapAtom } from '@/atoms/terminal-atoms'
import { toolStreamOutputAtom, delegationActivityAtom, showDelegationUiAtom } from '@/atoms/tool-stream-atoms'
import { cn } from '@/lib/utils'
import { MarkdownStreamingContext, MessageResponse } from '@/components/ai-elements/message'
import { getToolIcon, extractFilePath } from './tool-utils'
import { getToolPhrase, getToolResultSummary, shouldShowToolKindLabel } from './tool-phrase'
import { ToolResultRenderer } from './tool-result-renderers'
import { PreviewOpenButton } from './tool-result-renderers/preview-open-button'
import { getTaskGetStatusLabel, parseTaskGetResult, type ParsedTaskGetResult } from './tool-result-renderers/task-get-result'
import { parseTaskListResult, type ParsedTaskListItem } from './tool-result-renderers/task-list-result'
import { formatDuration } from './AgentMessages'
import { useSmoothStream } from '@guru/ui'
import type {
  SDKContentBlock,
  SDKMessage,
  SDKTextBlock,
  SDKToolUseBlock,
  SDKThinkingBlock,
  SDKUserMessage,
  SDKToolResultBlock,
  SDKSystemMessage,
} from '@guru/shared'

// ===== 发送命令到终端 =====

/** 渲染层 Agent 终端实例 ID 分配（与主进程 Agent 专用空间一致，>= 1000）
 * 不复用仍挂着的实例；已关闭的实例 ID 会被重新分配。
 */
let agentTerminalInstanceSeq = 1000

/** 判断是否为命令类工具（可“在终端运行”） */
function isCommandTool(toolName: string): boolean {
  return toolName === 'Bash' || toolName === 'powershell' || toolName === 'PowerShell' || toolName === 'TerminalExecute'
}

/** 从工具输入中提取要执行的命令 */
function extractCommand(input: Record<string, unknown>): string | null {
  const raw = input.command ?? input.cmd
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return null
}

// ===== useToolResult Hook =====

interface ToolResultData {
  result?: string
  isError?: boolean
}

/** 在 allMessages 中查找匹配 toolUseId 的工具结果 */
function useToolResult(toolUseId: string, allMessages: SDKMessage[]): ToolResultData | null {
  return React.useMemo(() => {
    for (const msg of allMessages) {
      if (msg.type !== 'user') continue
      const userMsg = msg as SDKUserMessage
      const contentBlocks = userMsg.message?.content
      if (!Array.isArray(contentBlocks)) continue

      for (const block of contentBlocks) {
        if (block.type === 'tool_result') {
          const resultBlock = block as SDKToolResultBlock
          if (resultBlock.tool_use_id === toolUseId) {
            let result: string | undefined
            if (typeof resultBlock.content === 'string') {
              result = resultBlock.content
            } else if (Array.isArray(resultBlock.content)) {
              result = (resultBlock.content as Array<{ type: string; text?: string }>)
                .filter((c) => c.type === 'text' && typeof c.text === 'string')
                .map((c) => c.text)
                .join('\n')
            }
            return { result, isError: resultBlock.is_error }
          }
        }
      }
    }
    return null
  }, [toolUseId, allMessages])
}

// ===== useSubAgentMeta Hook =====

interface SubAgentMeta {
  durationMs: number
  totalTokens: number
  toolUses: number
}

/** 从 allMessages 中查找匹配 toolUseId 的 task_notification 系统消息，提取用量数据 */
function useSubAgentMeta(toolUseId: string, allMessages: SDKMessage[]): SubAgentMeta | null {
  return React.useMemo(() => {
    for (const msg of allMessages) {
      if (msg.type !== 'system') continue
      const sysMsg = msg as SDKSystemMessage
      if (sysMsg.subtype !== 'task_notification') continue
      if (sysMsg.tool_use_id !== toolUseId) continue
      const usage = sysMsg.usage
      if (!usage) return null
      return {
        durationMs: usage.duration_ms ?? 0,
        totalTokens: usage.total_tokens ?? 0,
        toolUses: usage.tool_uses ?? 0,
      }
    }
    return null
  }, [toolUseId, allMessages])
}

// ===== SubAgent 结果文本解析 =====

interface ParsedAgentResult {
  /** 清理后的输出文本（去除元数据） */
  text: string
  /** 从 <usage> 标签解析的用量数据（作为 task_notification 的备用） */
  usage?: SubAgentMeta
}

/** 从 Agent tool_result 文本中分离内容与元数据（agentId 行 + <usage> 标签） */
function parseAgentResultText(raw: string): ParsedAgentResult {
  let text = raw

  // 提取 <usage> 标签中的用量数据
  let usage: SubAgentMeta | undefined
  const usageMatch = text.match(/<usage>([\s\S]*?)<\/usage>/)
  if (usageMatch) {
    const body = usageMatch[1]!
    const totalTokens = Number(body.match(/total_tokens:\s*(\d+)/)?.[1]) || 0
    const toolUses = Number(body.match(/tool_uses:\s*(\d+)/)?.[1]) || 0
    const durationMs = Number(body.match(/duration_ms:\s*(\d+)/)?.[1]) || 0
    if (totalTokens > 0 || toolUses > 0 || durationMs > 0) {
      usage = { durationMs, totalTokens, toolUses }
    }
    text = text.replace(/<usage>[\s\S]*?<\/usage>/, '')
  }

  // 移除 agentId 行
  text = text.replace(/agentId:.*\n?/g, '')

  // 移除 <output> 标签包裹
  text = text.replace(/<\/?output>/g, '')

  return { text: text.trim(), usage }
}

// ===== 委派完成信息尾部（友好摘要，替代原始 JSON） =====

/** 报告标题：优先子 Agent 标题；缺失时从正文提取首个 Markdown 标题；再无则序号兜底 */
function getReportTitle(summary: { title?: string; text: string }, index: number, total: number): string {
  if (summary.title && summary.title.trim()) return summary.title
  const heading = summary.text.match(/^#{1,3}\s+(.+)$/m)
  if (heading?.[1]) return heading[1].trim()
  return total > 1 ? `子 Agent 报告 ${index + 1}` : '子 Agent 报告'
}

interface ParsedDelegationResult {
  statuses: string[]
  resultSummaries: Array<{ title?: string; role?: string; text: string }>
  errors: string[]
}

/** 结果 JSON 是否“全是 running”（启动快照，重启后无 final 事件更新时为 true，属过期状态） */
function parsedRunningOnly(resultText?: string): boolean {
  if (!resultText) return false
  try {
    const parsed = JSON.parse(resultText) as { delegation?: { status?: string }; delegations?: Array<{ status?: string }> }
    const items = parsed.delegation ? [parsed.delegation] : (parsed.delegations ?? [])
    return items.length > 0 && items.every((d) => d.status === 'running')
  } catch {
    return false
  }
}

/** 从委派工具结果 JSON 提取友好摘要 */
function parseDelegationResult(resultText?: string): ParsedDelegationResult {
  const empty: ParsedDelegationResult = { statuses: [], resultSummaries: [], errors: [] }
  if (!resultText) return empty
  try {
    const parsed = JSON.parse(resultText) as {
      delegation?: { status?: string; resultSummary?: string; error?: string; title?: string }
      delegations?: Array<{ status?: string; resultSummary?: string; error?: string; title?: string }>
      failures?: Array<{ index?: number; title?: string; error?: string }>
      note?: string
    }
    const items = parsed.delegation ? [parsed.delegation] : (parsed.delegations ?? [])
    return {
      statuses: items.map((d) => d.status ?? 'unknown'),
      resultSummaries: items.map((d) => ({ title: d.title, role: undefined, text: d.resultSummary ?? '' })).filter((r) => r.text),
      errors: [
        ...items.map((d) => d.error ?? '').filter(Boolean),
        ...(parsed.failures ?? []).map((f) => f.error ?? ''),
      ],
    }
  } catch {
    return empty
  }
}

function DelegationFooter({ resultText, activities, hideStatus, isStale }: { resultText?: string; activities?: Array<{ phase: string; result?: string; isError?: boolean; title?: string; role?: string }>; hideStatus?: boolean; isStale?: boolean }): React.ReactElement | null {
  const parsed = React.useMemo(() => {
    // 优先使用主进程终态事件携带的 resultSummary（完整报告）——收集全部 final（批量委派多个子 Agent）
    const finalActivities = activities?.filter((a) => a.phase === 'final' && a.result)
    if (finalActivities && finalActivities.length > 0) {
      return {
        statuses: finalActivities.map((a) => (a.isError ? 'failed' : 'completed')),
        resultSummaries: finalActivities.map((a) => ({ title: a.title, role: a.role, text: a.result! })),
        errors: finalActivities.filter((a) => a.isError).map((a) => a.result!).filter(Boolean),
      }
    }
    return parseDelegationResult(resultText)
  }, [resultText, activities])
  const done = parsed.statuses.filter((s) => s === 'completed').length
  const failed = parsed.statuses.filter((s) => s === 'failed' || s === 'cancelled' || s === 'interrupted').length
  const running = parsed.statuses.filter((s) => s === 'running').length
  const total = parsed.statuses.length
  const [reportsExpanded, setReportsExpanded] = React.useState(false)

  if (total === 0 && parsed.errors.length === 0 && parsed.resultSummaries.length === 0) return null

  // 多个摘要时默认只展开第一个，其余折叠（避免批量委派时超长）；再次点击可收起
  const showAll = reportsExpanded || parsed.resultSummaries.length <= 1
  const canCollapse = reportsExpanded && parsed.resultSummaries.length > 1

  // 过期快照（重启后）：不显示误导的“0/3 运行中”，提示结果位置
  const staleOnly = isStale && parsed.resultSummaries.length === 0 && parsed.errors.length === 0

  return (
    <div className="mt-3 pt-2 border-t-2 border-border/30 space-y-2">
      {/* 状态摘要：醒目（仅当没有活动区状态头时显示，避免重复） */}
      {!hideStatus && !staleOnly && (
        <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground/80">
          <CheckCircle2 className="size-4 text-emerald-500/90" />
          <span>
            {total > 0
              ? (running > 0
                  ? `完成 ${done}/${total} 个子 Agent（${running} 个运行中）`
                  : failed > 0
                    ? `完成 ${done}/${total} 个子 Agent（${failed} 个失败/中断）`
                    : `已完成 ${total} 个子 Agent`)
              : '委派已完成'}
          </span>
        </div>
      )}
      {staleOnly && (
        <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground/80">
          <History className="size-3.5 shrink-0 text-muted-foreground/60" />
          本次会话重启前的委派——详细结果见下方「等待子会话完成」工具行
        </div>
      )}

      {/* 结果摘要（Markdown 渲染，每份带子 Agent 标题） */}
      {parsed.resultSummaries.slice(0, showAll ? undefined : 1).map((summary, i) => (
        <div key={i} className="min-w-0">
          <div className="overflow-hidden rounded-lg border border-border/25 bg-background/40">
            <div className="flex items-center gap-1.5 border-b border-border/10 bg-muted/30 px-3 py-1.5">
              <span className={cn('size-2 shrink-0 rounded-full', roleStyle(summary.role).accent)} />
              <Bot className="size-3 shrink-0 text-primary/70" />
              <span className="truncate text-[12px] font-semibold text-foreground/90">
                {getReportTitle(summary, i, parsed.resultSummaries.length)}
              </span>
              {summary.role && <span className="ml-auto shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">{summary.role}</span>}
            </div>
            <div className="px-3 py-2 text-[13px] leading-relaxed text-muted-foreground/80 max-w-full">
              <MessageResponse>{summary.text}</MessageResponse>
            </div>
          </div>
        </div>
      ))}

      {/* 展开全部按钮：放在报告列表之后（看完第一份再决定是否展开） */}
      {!showAll && parsed.resultSummaries.length > 1 && (
        <button
          type="button"
          onClick={() => setReportsExpanded(true)}
          className="mx-auto flex items-center gap-1 rounded-full border border-border/30 bg-background/40 px-3 py-1 text-[12px] font-medium text-primary/80 hover:bg-primary/5 hover:text-primary transition-colors"
        >
          <ChevronDown className="size-3" />
          还有 {parsed.resultSummaries.length - 1} 份报告，点击展开全部
        </button>
      )}

      {canCollapse && (
        <button
          type="button"
          onClick={() => setReportsExpanded(false)}
          className="mx-auto flex items-center gap-1 rounded-full border border-border/30 bg-background/40 px-3 py-1 text-[12px] font-medium text-muted-foreground/70 hover:text-foreground transition-colors"
        >
          <ChevronUp className="size-3" />
          收起全部报告
        </button>
      )}

      {/* 错误 */}
      {parsed.errors.map((err, i) => (
        <div key={`err-${i}`} className="flex items-start gap-1.5 text-[12px] text-destructive/80">
          <XCircle className="mt-0.5 size-3 shrink-0" />
          <span className="min-w-0 break-all">{err}</span>
        </div>
      ))}
    </div>
  )
}

// ===== 委派活动列表（工具启动+结果配对成一行，可展开查看输出） =====

/** 子 Agent 角色 → 视觉颜色（一眼区分不同角色） */
const ROLE_STYLES: Record<string, { border: string; header: string; badge: string; accent: string }> = {
  research: { border: 'border-sky-500/25', header: 'bg-gradient-to-r from-sky-500/10 to-transparent', badge: 'bg-sky-500/15 text-sky-600 dark:text-sky-400', accent: 'bg-sky-500/70' },
  implement: { border: 'border-violet-500/25', header: 'bg-gradient-to-r from-violet-500/10 to-transparent', badge: 'bg-violet-500/15 text-violet-600 dark:text-violet-400', accent: 'bg-violet-500/70' },
  review: { border: 'border-amber-500/25', header: 'bg-gradient-to-r from-amber-500/10 to-transparent', badge: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', accent: 'bg-amber-500/70' },
  explore: { border: 'border-emerald-500/25', header: 'bg-gradient-to-r from-emerald-500/10 to-transparent', badge: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', accent: 'bg-emerald-500/70' },
  custom: { border: 'border-rose-500/25', header: 'bg-gradient-to-r from-rose-500/10 to-transparent', badge: 'bg-rose-500/15 text-rose-600 dark:text-rose-400', accent: 'bg-rose-500/70' },
}
const DEFAULT_ROLE_STYLE = { border: 'border-primary/25', header: 'bg-gradient-to-r from-primary/10 to-transparent', badge: 'bg-muted text-muted-foreground', accent: 'bg-primary/70' }
function roleStyle(role?: string): { border: string; header: string; badge: string; accent: string } {
  return (role && ROLE_STYLES[role]) || DEFAULT_ROLE_STYLE
}
interface DelegationActivityItem {
  seq: number
  ts: number
  phase: string
  toolName?: string
  brief?: string
  isError?: boolean
  text?: string
  result?: string
  toolUseId?: string
  title?: string
  role?: string
  parentToolUseId?: string
}

function DelegationActivityList({ activities, isCompleted }: { activities: DelegationActivityItem[]; isCompleted?: boolean }): React.ReactElement {
  const [expandedResults, setExpandedResults] = React.useState<Set<string>>(new Set())
  // 配对：tool_start + 同 toolUseId 的 tool_result 合成一行；assistant 文本单独行
  const rows = React.useMemo(() => {
    const sorted = [...activities].sort((a, b) => a.seq - b.seq)
    const paired: Array<{
      key: string
      toolName?: string
      brief?: string
      isError?: boolean
      result?: string
      toolUseId?: string
      status: 'running' | 'done' | 'error' | 'none'
    }> = []
    const resultByTool = new Map<string, { isError?: boolean; result?: string }>()
    for (const act of sorted) {
      if (act.phase === 'tool_result' && act.toolUseId) {
        resultByTool.set(act.toolUseId, { isError: act.isError, result: act.result })
      }
    }
    for (const act of sorted) {
      if (act.phase === 'tool_start') {
        const result = act.toolUseId ? resultByTool.get(act.toolUseId) : undefined
        paired.push({
          key: `${act.seq}`,
          toolName: act.toolName,
          brief: act.brief,
          toolUseId: act.toolUseId,
          isError: result?.isError,
          result: result?.result,
          status: result ? (result.isError ? 'error' : 'done') : 'running',
        })
      }
    }
    const texts = sorted.filter((a) => a.phase === 'assistant' && a.text)
    return { paired, texts }  }, [activities])

  const toggle = (key: string): void => {
    setExpandedResults((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="space-y-0.5">
      {rows.paired.map((row) => {
        const isOpen = expandedResults.has(row.key)
        const hasContent = !!row.result
        return (
          <div key={row.key}>
            <button
              type="button"
              onClick={() => hasContent && toggle(row.key)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] leading-5 transition-colors',
                hasContent ? 'cursor-pointer hover:bg-muted/50' : 'cursor-default',
              )}
            >
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full',
                  row.status === 'running' ? 'bg-primary/10' : row.status === 'error' ? 'bg-destructive/10' : 'bg-emerald-500/10',
                )}
              >
                {row.status === 'running' ? (
                  <Loader2 className="size-3 animate-spin text-primary/70" />
                ) : row.status === 'error' ? (
                  <XCircle className="size-3 text-destructive/80" />
                ) : (
                  <CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground/85">
                {row.toolName}
                {row.brief && <span className="text-muted-foreground/60"> · {row.brief}</span>}
              </span>
              {/* 状态徽章：与工具同行 */}
              {row.status === 'running' ? (
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-px text-[11px] text-primary/80">执行中</span>
              ) : (
                <span className={cn(
                  'shrink-0 rounded-full px-2 py-px text-[11px]',
                  row.status === 'error' ? 'bg-destructive/10 text-destructive/80' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                )}>
                  {row.status === 'error' ? '失败' : '完成'}
                </span>
              )}
              {hasContent && (
                <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground/40 transition-transform', isOpen && 'rotate-90')} />
              )}
            </button>
            {hasContent && isOpen && (
              <pre className="ml-6 mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border/30 bg-background/60 p-2.5 font-mono text-[12px] leading-relaxed text-muted-foreground/90">
                {row.result}
              </pre>
            )}
          </div>
        )
      })}
      {/* 过程文本：仅未完成时显示（完成后的完整报告由 footer 展示，避免重复） */}
      {!isCompleted && rows.texts.slice(-3).map((t, i) => (
        <DelegationTextRow key={`text-${i}`} text={t.text} />
      ))}
    </div>
  )
}

/** 子 Agent 活动文本行：短文本直接显示，长文本（可能是完整报告）折叠避免与 footer 重复 */
function DelegationTextRow({ text }: { text?: string }): React.ReactElement | null {
  const [expanded, setExpanded] = React.useState(false)
  if (!text) return null
  const isLong = text.length > 300
  const shown = isLong && !expanded ? `${text.slice(0, 300)}…` : text
  return (
    <div className="pl-2 pr-1 py-0.5 min-w-0">
      <MessageResponse>{shown}</MessageResponse>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-[12px] text-primary/70 hover:text-primary transition-colors"
        >
          {expanded ? '收起' : '展开全文'}
        </button>
      )}
    </div>
  )
}

// ===== 委派完成信息尾部 =====

function SubAgentFooter({
  meta,
  resultText,
}: {
  meta: SubAgentMeta | null
  resultText?: string
}): React.ReactElement | null {
  // 解析结果文本，分离内容与元数据
  const parsed = React.useMemo(
    () => resultText ? parseAgentResultText(resultText) : null,
    [resultText],
  )

  // 优先使用 task_notification 的用量数据，备用从 result 文本中解析
  const effectiveMeta = meta ?? parsed?.usage ?? null
  const cleanText = parsed?.text || ''

  // 没有任何信息时不渲染
  if (!effectiveMeta && !cleanText) return null

  return (
    <div className="mt-2 pt-2 border-t border-border/20 space-y-1.5">
      {/* 最终输出文本（Markdown 渲染） */}
      {cleanText && (
        <div className="text-muted-foreground/70">
          <MessageResponse>{cleanText}</MessageResponse>
        </div>
      )}

      {/* 用量统计行（最底部） */}
      {effectiveMeta && (
        <div className="flex items-center gap-3 text-[12px] text-muted-foreground/60 tabular-nums">
          {effectiveMeta.durationMs > 0 && (
            <span>{formatDuration(effectiveMeta.durationMs)}</span>
          )}
          {effectiveMeta.totalTokens > 0 && (
            <span>{effectiveMeta.totalTokens.toLocaleString()} tokens</span>
          )}
          {effectiveMeta.toolUses > 0 && (
            <span>{effectiveMeta.toolUses} 次工具调用</span>
          )}
        </div>
      )}
    </div>
  )
}

// ===== ContentBlock Props =====

export interface ContentBlockProps {
  /** 内容块数据 */
  block: SDKContentBlock
  /** 所有消息（用于查找工具结果） */
  allMessages: SDKMessage[]
  /** 相对路径解析基准（文件链接用） */
  basePath?: string
  /** 多个可解析相对路径的基准目录 */
  basePaths?: string[]
  /** 是否启用入场动画 */
  animate?: boolean
  /** 在父级中的索引（用于动画延迟） */
  index?: number
  /** 当 turn 中已有主要内容（text）时，非主要块（tool/thinking）颜色变淡 */
  dimmed?: boolean
  /** 子代理的内容块（Agent/Task 工具调用的嵌套子块） */
  childBlocks?: SDKContentBlock[]
  /** 是否正在流式输出中（仅流式中的未完成工具调用才显示 spinner） */
  isStreaming?: boolean
}

// ===== 提示词折叠行 =====

function PromptRow({ prompt, dimmed = false }: { prompt: string; dimmed?: boolean }): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false)
  const preview = prompt.length > 60 ? prompt.slice(0, 60) + '…' : prompt

  return (
    <div>
      <button
        type="button"
        className="flex items-center gap-2 py-0.5 text-left hover:opacity-70 transition-opacity group"
        onClick={() => setExpanded(!expanded)}
      >
        <MessageSquareText className={cn('size-3.5 shrink-0', dimmed ? 'text-muted-foreground/70' : 'text-muted-foreground')} />

        <span className={cn(
          'shrink-0 text-[14px]',
          dimmed ? 'text-muted-foreground/70' : 'text-muted-foreground',
        )}>提示词</span>

        <span className={cn(
          'truncate text-[14px]',
          dimmed ? 'text-muted-foreground/50' : 'text-muted-foreground/60',
        )}>
          {preview}
        </span>

        <ChevronRight
          className={cn(
            'shrink-0 size-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-[opacity,transform] duration-fast',
            expanded && 'rotate-90 opacity-100',
          )}
        />
      </button>

      {expanded && (
        <div className="ml-5.5 mt-1 mb-2 pl-3 border-l-2 border-border/30 animate-in fade-in slide-in-from-top-1 duration-fast">
          <p className="text-[13px] text-foreground/70 leading-relaxed whitespace-pre-wrap break-words">
            {prompt}
          </p>
        </div>
      )}
    </div>
  )
}

// ===== 工具短语 diff 着色 =====

function TaskGetCollapsedSummary({ task }: { task: ParsedTaskGetResult }): React.ReactElement {
  const blockPreview = task.blocks.length > 0
    ? `${task.blocks[0]}${task.blocks.length > 1 ? ` +${task.blocks.length - 1}` : ''}`
    : undefined

  return (
    <>
      {task.subject && (
        <>
          <span className="shrink-0 text-muted-foreground/35">·</span>
          <span className="min-w-0 truncate text-[14px] font-medium text-foreground/75">
            {task.subject}
          </span>
        </>
      )}
      {task.description && (
        <span className="hidden min-w-0 truncate text-[13px] text-muted-foreground/60 sm:inline">
          {task.description}
        </span>
      )}
      {task.status && (
        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
          {getTaskGetStatusLabel(task.status)}
        </span>
      )}
      {blockPreview && (
        <span className="shrink-0 rounded-sm bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground/70">
          关联 {blockPreview}
        </span>
      )}
    </>
  )
}

function TaskListCollapsedSummary({ tasks }: { tasks: ParsedTaskListItem[] }): React.ReactElement {
  const completedCount = tasks.filter((task) => task.status === 'completed').length
  const activeCount = tasks.filter((task) => task.status === 'in_progress').length
  const pendingCount = tasks.filter((task) => task.status === 'pending').length

  return (
    <>
      <span className="shrink-0 text-muted-foreground/35">·</span>
      <span className="shrink-0 rounded-full bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground/75">
        {completedCount}/{tasks.length} 已完成
      </span>
      {activeCount > 0 && (
        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
          {activeCount} 进行中
        </span>
      )}
      {pendingCount > 0 && (
        <span className="hidden shrink-0 rounded-full bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground/65 sm:inline">
          {pendingCount} 待处理
        </span>
      )}
    </>
  )
}

// ===== 工具调用块 =====

interface ToolUseBlockProps {
  block: SDKToolUseBlock
  allMessages: SDKMessage[]
  animate?: boolean
  index?: number
  dimmed?: boolean
  childBlocks?: SDKContentBlock[]
  basePath?: string
  /** 是否正在流式输出中 */
  isStreaming?: boolean
}

function ToolUseBlock({ block, allMessages, animate = false, index = 0, dimmed = false, childBlocks, basePath, isStreaming }: ToolUseBlockProps): React.ReactElement | null {
  const [expanded, setExpanded] = React.useState(false)
  const toolResult = useToolResult(block.id, allMessages)
  const resultText = toolResult?.result
  const isError = toolResult?.isError === true
  const shouldShowResult = !!resultText
  // 工具执行中的流式输出（SDK onUpdate → tool_execution_update → toolStreamOutputAtom）
  const toolStreamOutput = useAtomValue(toolStreamOutputAtom).get(block.id)
  const streamOutput = toolStreamOutput ?? ''
  const taskGetSummary = React.useMemo(() => {
    if (block.name !== 'TaskGet' || !resultText || isError) return null
    return parseTaskGetResult(resultText)
  }, [block.name, resultText, isError])
  const taskListSummary = React.useMemo(() => {
    if (block.name !== 'TaskList' || !resultText || isError) return null
    return parseTaskListResult(resultText)
  }, [block.name, resultText, isError])
  const isAgentTool = block.name === 'Agent' || block.name === 'Task'
  // 协作委派工具（delegate_agent / delegate_agents / wait_for_delegations 等）也视为子 Agent 容器：
  // delegate 行显示实时活动；wait/list/get 行可从自身 tool_result JSON 恢复各子 Agent 完整报告（重启后仍可用）
  const isDelegationTool =
    block.name === 'mcp__collaboration__delegate_agent'
    || block.name === 'mcp__collaboration__delegate_agents'
    || block.name === 'mcp__collaboration__wait_for_delegations'
    || block.name === 'mcp__collaboration__list_delegations'
    || block.name === 'mcp__collaboration__get_delegation_results'
  // 用户设置：是否显示子 Agent 执行 UI（关闭则不渲染，功能照常）
  const showDelegationUi = useAtomValue(showDelegationUiAtom)
  const hasChildren = (isAgentTool || isDelegationTool) && childBlocks && childBlocks.length > 0
  const subAgentMeta = useSubAgentMeta(block.id, allMessages)
  // 从 tool_result 解析 delegationId（委派工具的 result 是含 delegationId 的 JSON）
  const delegationIds = React.useMemo(() => {
    if (!isDelegationTool || !resultText) return []
    const ids: string[] = []
    try {
      const parsed = JSON.parse(resultText) as { delegation?: { delegationId?: string } | null; delegations?: Array<{ delegationId?: string }> }
      if (parsed.delegation?.delegationId) ids.push(parsed.delegation.delegationId)
      if (Array.isArray(parsed.delegations)) {
        for (const d of parsed.delegations) if (d.delegationId) ids.push(d.delegationId)
      }
    } catch {
      // 结果不是 JSON（可能是错误信息），忽略
    }
    return ids
  }, [isDelegationTool, resultText])
  // 子 Agent 实时活动（主进程 eventBus 转发 delegation_progress → atom），按子 Agent 分组
  // 关联方式：优先按父会话委派工具的 toolUseId（block.id）匹配（委派执行中即可显示）；
  // 兜底从 tool_result JSON 解析 delegationId（历史消息/重载场景）
  const delegationActivityMap = useAtomValue(delegationActivityAtom)
  const matchedDelegationIds = React.useMemo(() => {
    // 按 parentToolUseId 匹配的活动（本工具行发起）
    const byToolUse = new Set<string>()
    for (const [delegationId, list] of delegationActivityMap) {
      if (list.some((a) => a.parentToolUseId === block.id)) byToolUse.add(delegationId)
    }
    // 从 tool_result 解析的 delegationId（兜底）
    const byResult = delegationIds
    return [...new Set([...byToolUse, ...byResult])]
  }, [delegationActivityMap, block.id, delegationIds])
  const delegationActivityGroups = React.useMemo(() => {
    if (!isDelegationTool || matchedDelegationIds.length === 0) return []
    const groups: Array<{
      delegationId: string
      title?: string
      role?: string
      activities: Array<{ seq: number; ts: number; phase: string; toolUseId?: string; toolName?: string; brief?: string; isError?: boolean; text?: string; result?: string }>
    }> = []
    for (const id of matchedDelegationIds) {
      const list = delegationActivityMap.get(id)
      if (!list || list.length === 0) continue
      groups.push({
        delegationId: id,
        title: list[list.length - 1]?.title,
        role: list[list.length - 1]?.role,
        activities: [...list].sort((a, b) => a.seq - b.seq),
      })
    }
    return groups
  }, [isDelegationTool, matchedDelegationIds, delegationActivityMap])
  const delegationActivities = React.useMemo(() => {
    return delegationActivityGroups.flatMap((g) => g.activities)
  }, [delegationActivityGroups])

  // Agent/Task 子代理内容默认折叠
  const [childrenExpanded, setChildrenExpanded] = React.useState(false)

  const phrase = getToolPhrase(block.name, block.input)
  const ToolIcon = getToolIcon(block.name)
  const toolKindLabel = block.name.startsWith('mcp__') ? block.name.split('__').slice(1).join(' / ') : block.name
  const showToolKindLabel = shouldShowToolKindLabel(block.name, block.input, toolKindLabel, phrase.label)

  const isCompleted = toolResult !== null
  const resultSummary = getToolResultSummary(block.name, resultText, isError)

  // 运行中显示进行时短语，完成或非流式（已终止）显示完成态短语
  const displayLabel = (isCompleted || !isStreaming) ? phrase.label : phrase.loadingLabel
  const filePath = extractFilePath(block.input)
  const isPreviewable = (
    (block.name === 'Read' || block.name === 'Edit' || block.name === 'Write') &&
    isCompleted &&
    filePath
  )

  // ===== 在终端运行（命令类工具） =====
  const activeSessionId = useAtomValue(activeSessionIdAtom)
  const setTerminalPanelOpen = useSetAtom(terminalPanelOpenMapAtom)
  const terminalStateMap = useAtomValue(terminalStateMapAtom)
  const commandToRun = isCommandTool(block.name) ? extractCommand(block.input) : null
  const [terminalRunState, setTerminalRunState] = React.useState<'idle' | 'running' | 'error'>('idle')
  const handleRunInTerminal = React.useCallback(async () => {
    if (!commandToRun || !activeSessionId || terminalRunState === 'running') return
    const openApi = (window.electronAPI as Partial<typeof window.electronAPI>).openAgentTerminal
    const writeApi = (window.electronAPI as Partial<typeof window.electronAPI>).writeAgentTerminal
    if (typeof openApi !== 'function' || typeof writeApi !== 'function') return
    setTerminalRunState('running')
    try {
      // 优先复用该会话已有的 Agent 终端（无论是否可见）：直接把命令写进去，不新开 Tab
      const existingAgentTerminal = [...terminalStateMap.values()]
        .filter((s) => s.sessionId === activeSessionId)
        .sort((a, b) => Number(a.terminalId.split('#').pop() ?? 0) - Number(b.terminalId.split('#').pop() ?? 0))
        .find((s) => Number(s.terminalId.split('#').pop() ?? 0) >= 1000)
      if (existingAgentTerminal) {
        await writeApi({ terminalId: existingAgentTerminal.terminalId, data: `${commandToRun}\r` })
      } else {
        // 无已有 Agent 终端：分配空闲实例 ID 新开
        const usedIds = new Set<number>()
        for (const key of terminalStateMap.keys()) {
          if (!key.startsWith(`${activeSessionId}#`)) continue
          const num = Number(key.split('#').pop() ?? 0)
          if (Number.isFinite(num) && num >= 1000) usedIds.add(num)
        }
        let instanceId = agentTerminalInstanceSeq
        while (usedIds.has(instanceId)) instanceId += 1
        agentTerminalInstanceSeq = instanceId + 1
        const state = await openApi({ sessionId: activeSessionId, instanceId, cols: 80, rows: 24 })
        await writeApi({ terminalId: state.terminalId, data: `${commandToRun}\r` })
      }
      // 打开终端面板（若已打开则保持；未打开则弹出）
      setTerminalPanelOpen((previous) => {
        const next = new Map(previous)
        next.set(activeSessionId, true)
        return next
      })
      setTerminalRunState('idle')
    } catch {
      setTerminalRunState('error')
    }
  }, [commandToRun, activeSessionId, terminalRunState, setTerminalPanelOpen, terminalStateMap])

  const delay = animate && index < 10 ? `${index * 30}ms` : '0ms'

  // Agent/Task: 提取 prompt 用于气泡展示
  const agentPrompt = isAgentTool
    ? (typeof block.input.prompt === 'string' ? block.input.prompt : undefined)
    : undefined

  // 子代理工具调用统计
  const childToolCount = childBlocks?.filter((b) => b.type === 'tool_use').length ?? 0

  // 当前执行步骤摘要（委派工具收缩时显示）：每个子 Agent 最近一条 tool_start 的工具名+摘要
  const currentStep = React.useMemo(() => {
    if (!isDelegationTool) return null
    const steps: string[] = []
    for (const group of delegationActivityGroups) {
      const lastToolStart = [...group.activities].reverse().find((a) => a.phase === 'tool_start')
      if (lastToolStart) {
        const label = group.title ? group.title.replace(/^协作[：:]\s*/, '').slice(0, 12) : undefined
        const detail = lastToolStart.brief ? `${lastToolStart.toolName ?? '工具'} · ${lastToolStart.brief}` : (lastToolStart.toolName ?? '工具')
        const clipped = detail.length > 30 ? `${detail.slice(0, 30)}…` : detail
        steps.push(label ? `${label}: ${clipped}` : clipped)
      }
    }
    if (steps.length === 0) return null
    const shown = steps.slice(0, 3)
    const rest = steps.length - shown.length
    return shown.join(' ｜ ') + (rest > 0 ? ` 等 ${rest} 个` : '')
  }, [isDelegationTool, delegationActivityGroups])

  // 工具步数统计：仅计 tool_start（排除 assistant 文本活动，避免语义混乱）
  const delegationStepCount = React.useMemo(() => {
    return delegationActivityGroups.reduce((sum, g) => sum + g.activities.filter((a) => a.phase === 'tool_start').length, 0)
  }, [delegationActivityGroups])

  // 委派是否活跃：有活动且未完成（不依赖 turn 级 isStreaming）
  const delegationActive = isDelegationTool && !isCompleted && delegationActivities.length > 0

  // ===== Agent/Task 工具（含协作委派）：特殊渲染 =====
  if (isAgentTool || isDelegationTool) {
    // 用户关闭子 Agent UI：不渲染委派工具行（功能照常执行）
    if (isDelegationTool && !showDelegationUi) return null
    return (
      <div
        className={cn(
          animate && 'animate-in fade-in duration-fast fill-mode-both',
        )}
        style={animate ? { animationDelay: delay } : undefined}
      >
        <button
          type="button"
          className="group flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left transition-[background-color,opacity] hover:bg-muted/40 hover:opacity-90"
          onClick={() => setChildrenExpanded(!childrenExpanded)}
        >
          <ChevronRight
            className={cn(
              'size-3 shrink-0 text-muted-foreground/45 transition-transform duration-fast',
              childrenExpanded && 'rotate-90',
            )}
          />

          {/* 状态指示：仅流式中的未完成工具才显示 spinner */}
          {!isCompleted && isStreaming ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary/60" />
          ) : isError ? (
            <XCircle className="size-3.5 shrink-0 text-destructive/70" />
          ) : null}

          <ToolIcon className="size-3.5 shrink-0 text-muted-foreground" />
          {showToolKindLabel && (
            <>
              <span className="min-w-0 max-w-[28%] truncate text-[14px] font-medium text-muted-foreground/65">{toolKindLabel}</span>
              <span className="shrink-0 text-muted-foreground/30">·</span>
            </>
          )}
          <span className="min-w-0 flex-1 truncate text-[14px] text-muted-foreground">{displayLabel}</span>
          {/* 委派工具收缩时：显示当前执行步骤 + 步数（完成后不显示 spinner 步骤） */}
          {isDelegationTool && !childrenExpanded && (
            <>
              {delegationActive && currentStep && (
                <span className="shrink-0 max-w-[40%] truncate text-[12px] text-muted-foreground/60">
                  <Loader2 className="mr-1 inline size-2.5 animate-spin text-primary/60" />
                  {currentStep}
                </span>
              )}
              {isDelegationTool && isCompleted && delegationActivityGroups.length > 0 && (
                <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-px text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  ✓ {delegationActivityGroups.filter((g) => g.activities.some((a) => a.phase === 'final' && !a.isError)).length}/{delegationActivityGroups.length}
                </span>
              )}
              {delegationStepCount > 0 && (
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/55">
                  {delegationStepCount} 步
                </span>
              )}
            </>
          )}
          {childToolCount > 0 && !childrenExpanded && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/55">
              {childToolCount} 项工具
            </span>
          )}
        </button>

        {/* 展开内容 */}
        {childrenExpanded && (
          <div className={cn(
            'pl-5 mt-1.5 space-y-2 border-l-2 border-primary/20 ml-[5px]',
            animate && 'animate-in fade-in slide-in-from-top-1 duration-fast',
          )}>
            {/* 提示词：可折叠行 */}
            {agentPrompt && <PromptRow prompt={agentPrompt} dimmed={dimmed} />}

            {/* 子 Agent 实时活动（委派工具：主进程转发 delegation_progress），按子 Agent 分组 */}
            {isDelegationTool && delegationActivityGroups.length > 0 && (
              <div className="mt-1.5 space-y-2">
                {/* 状态头：渐变胶囊条 */}
                <div className={cn(
                  'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold shadow-sm backdrop-blur',
                  isCompleted
                    ? 'bg-gradient-to-r from-emerald-500/15 to-teal-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-gradient-to-r from-primary/15 to-primary/5 text-primary',
                )}>
                  {isCompleted ? (
                    <CheckCircle2 className="size-4 shrink-0" />
                  ) : (
                    <Loader2 className="size-4 shrink-0 animate-spin" />
                  )}
                  <span className="truncate">
                    {isCompleted ? `子 Agent 执行完成（${delegationActivityGroups.length} 个）` : (delegationActivities.length > 0 ? `子 Agent 执行中（${delegationActivityGroups.length} 个）` : '等待子 Agent 启动…')}
                  </span>
                  {isCompleted && (
                    <span className="ml-auto hidden items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-px text-[11px] font-medium text-emerald-600 dark:text-emerald-400 sm:flex">
                      {delegationActivityGroups.filter((g) => g.activities.some((a) => a.phase === 'final' && !a.isError)).length}/{delegationActivityGroups.length} 成功
                    </span>
                  )}
                </div>
                {delegationActivityGroups.map((group, gi) => (
                  <div key={group.delegationId} className={cn(
                    'overflow-hidden rounded-xl border bg-background/60 shadow-sm backdrop-blur transition-colors',
                    roleStyle(group.role).border,
                    'hover:bg-background/80',
                    gi > 0 && 'mt-1.5',
                  )}>
                    {/* 子 Agent 标题栏：左彩色条 + 渐变底 */}
                    <div className={cn('relative flex items-center gap-2 px-3 py-2', roleStyle(group.role).header)}>
                      <span className={cn('absolute left-0 top-0 h-full w-[3px]', roleStyle(group.role).accent)} />
                      <Bot className="size-4 shrink-0 text-foreground/70" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-foreground">{group.title ?? group.delegationId.slice(0, 8)}</span>
                      {!isCompleted && group.activities.some((a) => a.phase === 'tool_start') && !group.activities.some((a) => a.phase === 'final') && (
                        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary/70" />
                      )}
                      <span className={cn('shrink-0 rounded-full px-2 py-[1.5px] text-[10.5px] font-semibold uppercase tracking-wider', roleStyle(group.role).badge)}>{group.role ?? 'agent'}</span>
                    </div>
                    <div className="px-2 py-1.5">
                      <DelegationActivityList activities={group.activities} isCompleted={isCompleted} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 子代理工具调用 */}
            {hasChildren && childBlocks.map((childBlock, ci) => (
              <ContentBlock
                key={ci}
                block={childBlock}
                allMessages={allMessages}
                basePath={basePath}
                animate={animate}
                index={ci}
                dimmed
                isStreaming={isStreaming}
              />
            ))}

            {/* SubAgent 完成信息（委派工具：显示友好摘要而非原始 JSON） */}
            {isCompleted && (
              isDelegationTool ? (
                <DelegationFooter resultText={toolResult?.result} activities={delegationActivities} hideStatus={delegationActivityGroups.length > 0} isStale={isDelegationTool && isCompleted && delegationActivityGroups.length === 0 && parsedRunningOnly(resultText)} />
              ) : (
                <SubAgentFooter
                  meta={subAgentMeta}
                  resultText={toolResult?.result}
                />
              )
            )}

            {/* 底部收起按钮 */}
            <button
              type="button"
              onClick={() => setChildrenExpanded(false)}
              className="flex items-center gap-1 text-xs text-foreground/40 hover:text-foreground/70 transition-colors"
            >
              <ChevronUp className="size-3" />
              <span>收起</span>
            </button>
          </div>
        )}
      </div>
    )
  }

  // ===== 普通工具：语义化短语 + 结构化结果 =====
  return (
    <div
      className={cn(
        animate && 'animate-in fade-in duration-fast fill-mode-both',
      )}
      style={animate ? { animationDelay: delay } : undefined}
    >
        <button
          type="button"
          className="group inline-flex max-w-full min-w-0 items-center gap-2 rounded-md py-1 text-left transition-[background-color,opacity] hover:bg-muted/40 hover:opacity-90"
          onClick={() => setExpanded(!expanded)}
        >
          {!isCompleted && isStreaming ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-primary/60" />
          ) : isError ? (
            <XCircle className="size-3.5 shrink-0 text-destructive/70" />
          ) : null}

          <ToolIcon className="size-3.5 shrink-0 text-muted-foreground" />
          {showToolKindLabel && (
            <>
              <span className="min-w-0 max-w-[28%] truncate text-[14px] font-medium text-muted-foreground/65">{toolKindLabel}</span>
              <span className="shrink-0 text-muted-foreground/30">·</span>
            </>
          )}
          <span className={cn(
            'min-w-0 max-w-[60%] truncate text-[14px]',
            dimmed ? 'text-muted-foreground/70' : 'text-muted-foreground',
          )}>{displayLabel}</span>

          {/* 仅工具已有结果时显示状态摘要（避免流式中/结果未返回时误显示“已完成”） */}
          {resultSummary && isCompleted && (
            <span className={cn(
              'shrink-0 text-[11px] tabular-nums',
              isError ? 'text-destructive/70' : 'text-muted-foreground/55',
            )}>
              {resultSummary}
            </span>
          )}

          {phrase.diffStats && (isCompleted || !isStreaming) && (
            <span className="shrink-0 font-mono text-[12px] tabular-nums">
              {phrase.diffStats.additions > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400">+{phrase.diffStats.additions}</span>
              )}
              {phrase.diffStats.additions > 0 && phrase.diffStats.deletions > 0 && ' '}
              {phrase.diffStats.deletions > 0 && (
                <span className="text-red-600 dark:text-red-400">-{phrase.diffStats.deletions}</span>
              )}
            </span>
          )}

          {taskGetSummary && (
            <span className="flex min-w-0 max-w-[40%] overflow-hidden items-center gap-1.5">
              <TaskGetCollapsedSummary task={taskGetSummary} />
            </span>
          )}

          {taskListSummary && (
            <span className="flex min-w-0 max-w-[40%] overflow-hidden items-center gap-1.5">
              <TaskListCollapsedSummary tasks={taskListSummary} />
            </span>
          )}

          {commandToRun && (
            <span className="shrink-0 flex items-center" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                title={`在终端运行: ${commandToRun}`}
                aria-label="在终端运行"
                onClick={() => void handleRunInTerminal()}
                disabled={terminalRunState === 'running'}
                className={cn(
                  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors',
                  terminalRunState === 'error'
                    ? 'text-destructive/80 hover:bg-destructive/10'
                    : 'text-muted-foreground/50 hover:bg-muted/60 hover:text-foreground',
                  'disabled:opacity-60',
                )}
              >
                {terminalRunState === 'running' ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Terminal className="size-3" />
                )}
                <span className="hidden group-hover:inline">
                  {terminalRunState === 'error' ? '失败' : '在终端运行'}
                </span>
              </button>
            </span>
          )}

          <ChevronRight
            className={cn(
              'size-3 shrink-0 text-muted-foreground/40 transition-transform duration-150',
              expanded && 'rotate-90',
            )}
          />

          {isPreviewable && (
            <PreviewOpenButton filePath={filePath} />
          )}
        </button>

      {(shouldShowResult && resultText && expanded) && (
        <div className={cn(
          'ml-5.5 mt-1 mb-2 pl-3 border-l-2 border-border/30',
          animate && 'animate-in fade-in slide-in-from-top-1 duration-fast',
        )}>
          <ToolResultRenderer
            toolName={block.name}
            input={block.input}
            result={resultText}
            isError={isError}
            basePath={basePath}
          />
        </div>
      )}

      {/* 工具执行中：展示 SDK 流式推送的实时输出（展开时） */}
      {!shouldShowResult && streamOutput && expanded && (
        <div className={cn(
          'ml-5.5 mt-1 mb-2 pl-3 border-l-2 border-border/30',
          animate && 'animate-in fade-in slide-in-from-top-1 duration-fast',
        )}>
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-muted-foreground/90 max-h-72 overflow-y-auto">
            {streamOutput}
          </pre>
        </div>
      )}
    </div>
  )
}

// ===== 思考块（默认展开，Thinking 标签 + 虚线边框） =====

interface ThinkingBlockProps {
  block: SDKThinkingBlock
  dimmed?: boolean
  isStreaming?: boolean
}

/** 思考块折叠行数阈值 */
const THINKING_COLLAPSE_LINE_THRESHOLD = 4
const THINKING_STREAMING_COLLAPSE_LINE_THRESHOLD = 2

function ThinkingBlock({ block, dimmed = false, isStreaming = false }: ThinkingBlockProps): React.ReactElement {
  const thinkingExpanded = useAtomValue(thinkingExpandedAtom)
  const [isExpanded, setIsExpanded] = React.useState(isStreaming ? false : thinkingExpanded)
  const [shouldCollapse, setShouldCollapse] = React.useState(false)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const wasStreamingRef = React.useRef(isStreaming)
  const { displayedContent } = useSmoothStream({
    content: block.thinking,
    isStreaming,
  })

  // 流式阶段默认收起，避免 Thinking 持续增长时占满对话区域；完成态保留原有展开阈值。
  React.useEffect(() => {
    if (isStreaming && !wasStreamingRef.current) {
      setIsExpanded(false)
    }
    wasStreamingRef.current = isStreaming
  }, [isStreaming])

  // 流式期间避免对每批思考文本同步读取 scrollHeight；这会强制布局且与 Markdown 重渲染叠加。
  // 输出完成后再测量，保留历史态的默认折叠行为。
  React.useLayoutEffect(() => {
    if (isStreaming || !contentRef.current) return
    const el = contentRef.current
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 22
    const maxHeight = lineHeight * THINKING_COLLAPSE_LINE_THRESHOLD
    setShouldCollapse(el.scrollHeight > maxHeight + 10)
  }, [displayedContent, isStreaming])

  // 当全局偏好变更时同步（仅在"应折叠"时生效）
  React.useEffect(() => {
    if (!isStreaming) setIsExpanded(thinkingExpanded)
  }, [isStreaming, thinkingExpanded])

  const toggleExpand = React.useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  const showCollapseControls = isStreaming || shouldCollapse
  const isCollapsed = showCollapseControls && !isExpanded

  return (
    <div className="relative mb-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Brain className={cn('size-3.5', dimmed ? 'text-muted-foreground/70' : 'text-muted-foreground')} />
        <span className={cn('text-[14px] uppercase tracking-wider', dimmed ? 'text-muted-foreground/70' : 'text-muted-foreground')}>
          Thinking
        </span>
      </div>
      <div
        className={cn(
          'relative rounded-lg px-3.5 py-2.5',
          dimmed ? 'bg-muted/30' : 'bg-muted/50',
        )}
        style={{
          border: 'none',
          backgroundImage: `url("data:image/svg+xml,%3csvg width='100%25' height='100%25' xmlns='http://www.w3.org/2000/svg'%3e%3crect width='100%25' height='100%25' fill='none' rx='8' ry='8' stroke='${dimmed ? 'rgba(128,128,128,0.3)' : 'rgba(128,128,128,0.5)'}' stroke-width='1.5' stroke-dasharray='8%2c 6' stroke-dashoffset='0' stroke-linecap='round'/%3e%3c/svg%3e")`,
        }}
      >
        <div
          ref={contentRef}
          data-agent-history-selection-excluded={isCollapsed ? 'true' : undefined}
          className={cn(
            'prose prose-sm dark:prose-invert max-w-none prose-p:my-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 text-[14px] leading-relaxed overflow-hidden transition-[max-height] duration-base',
            dimmed ? 'text-muted-foreground' : 'text-foreground/90',
            isCollapsed && (isStreaming ? 'max-h-[3.25em]' : 'max-h-[5.6em]'),
          )}
        >
          <MessageResponse className="font-normal prose-strong:font-normal [&_strong]:font-normal [&_b]:font-normal">
            {displayedContent}
          </MessageResponse>
        </div>
        {showCollapseControls && (
          <button
            type="button"
            onClick={toggleExpand}
            className={cn(
              'mt-2 flex items-center gap-1 text-xs text-foreground/35 transition-colors',
              'hover:text-foreground/55'
            )}
          >
            {isExpanded ? (
              <>
                <ChevronUp className="size-3" />
                <span>收起</span>
              </>
            ) : (
              <>
                <ChevronDown className="size-3" />
                <span>展开思考</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}

function StreamingTextBlock({
  text,
  isStreaming,
  basePath,
  basePaths,
}: {
  text: string
  isStreaming?: boolean
  basePath?: string
  basePaths?: string[]
}): React.ReactElement {
  const { displayedContent } = useSmoothStream({
    content: text,
    isStreaming: isStreaming ?? false,
  })

  // 逐字追赶显示的文本仍在增长中时标记 streaming：跳过语言自动检测等昂贵推断，
  // 排空后（displayedContent === text）context 默认 false，MessageResponse 静态渲染时再检测一次。
  return (
    <MarkdownStreamingContext.Provider value={!!isStreaming && displayedContent !== text}>
      <MessageResponse basePath={basePath} basePaths={basePaths}>{displayedContent}</MessageResponse>
    </MarkdownStreamingContext.Provider>
  )
}

// ===== ContentBlock 主组件 =====

export function ContentBlock({ block, allMessages, basePath, basePaths, animate = false, index = 0, dimmed = false, childBlocks, isStreaming }: ContentBlockProps): React.ReactElement | null {
  // text 块 — 主要内容，不受 dimmed 影响
  if (block.type === 'text') {
    const textBlock = block as SDKTextBlock
    if (!textBlock.text) return null
    return (
      <StreamingTextBlock
        text={textBlock.text}
        isStreaming={isStreaming}
        basePath={basePath}
        basePaths={basePaths}
      />
    )
  }

  // tool_use 块
  if (block.type === 'tool_use') {
    const toolBlock = block as SDKToolUseBlock
    return (
      <ToolUseBlock
        block={toolBlock}
        allMessages={allMessages}
        animate={animate}
        index={index}
        dimmed={dimmed}
        childBlocks={childBlocks}
        basePath={basePath}
        isStreaming={isStreaming}
      />
    )
  }

  // thinking 块
  if (block.type === 'thinking') {
    const thinkingBlock = block as SDKThinkingBlock
    if (!thinkingBlock.thinking) return null
    return <ThinkingBlock block={thinkingBlock} dimmed={dimmed} isStreaming={isStreaming} />
  }

  return null
}
