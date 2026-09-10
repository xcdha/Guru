/**
 * DiffPanelTabBar — 右侧面板顶部 Tab 栏
 *
 * 切换「相关文件」和「代码改动」视图，并追加本会话已打开的工作区组件 Tab
 * （待办 / 日程 / 定时任务 / MCP / 技能 / 记忆）。最右侧有关闭按钮。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { PanelRightClose, X, ListTodo, CalendarDays, Timer, Plug, Sparkles, Brain, Vault } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WINDOW_CONTROLS_INSET_RIGHT } from '@/lib/platform'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  agentDiffUnseenChangesAtom,
  currentAgentSessionIdAtom,
  agentSessionComponentOpenMapAtom,
  closeWorkspaceComponentAtom,
  sanitizeWorkspaceComponentTabs,
  WORKSPACE_COMPONENT_TAB_LABELS,
} from '@/atoms/agent-atoms'
import type { AgentSidePanelTab, WorkspaceComponentTab } from '@/atoms/agent-atoms'
import { interfaceVariantAtom } from '@/atoms/theme'

/** 工作区组件 Tab 的图标；与 Tab 条内新增项保持一致。 */
const WORKSPACE_COMPONENT_TAB_ICONS: Record<WorkspaceComponentTab, React.ComponentType<{ className?: string }>> = {
  todos: ListTodo,
  calendar: CalendarDays,
  automations: Timer,
  mcp: Plug,
  skills: Sparkles,
  memory: Brain,
  vault: Vault,
}

interface DiffPanelTabBarProps {
  activeTab: AgentSidePanelTab
  onTabChange: (tab: AgentSidePanelTab) => void
  onClose?: () => void
  onCloseChat?: () => void
  showChatTab?: boolean
  isWindows?: boolean
}

interface PreviousTabState {
  sessionId: string | null
  activeTab: AgentSidePanelTab
}

export function DiffPanelTabBar({
  activeTab,
  onTabChange,
  onClose,
  onCloseChat,
  showChatTab = false,
  isWindows = false,
}: DiffPanelTabBarProps): React.ReactElement {
  const unseenMap = useAtomValue(agentDiffUnseenChangesAtom)
  const setUnseenMap = useSetAtom(agentDiffUnseenChangesAtom)
  const currentSessionId = useAtomValue(currentAgentSessionIdAtom)
  const componentOpenMap = useAtomValue(agentSessionComponentOpenMapAtom)
  const closeWorkspaceComponent = useSetAtom(closeWorkspaceComponentAtom)
  // 本会话已打开的组件 Tab（由 openWorkspaceComponentAtom / revealChangedWorkspaceComponentAtom 写入）。
  // sanitize 过滤旧版本或损坏的持久化数据，避免渲染出没有内容的 Tab。
  const componentTabs = React.useMemo(
    () => sanitizeWorkspaceComponentTabs(componentOpenMap?.[currentSessionId ?? ''] ?? []),
    [componentOpenMap, currentSessionId],
  )
  const interfaceVariant = useAtomValue(interfaceVariantAtom)
  const isClassic = interfaceVariant === 'classic'
  const unseenChanges = unseenMap.get(currentSessionId ?? '') ?? false
  const normalizedActiveTab: AgentSidePanelTab = activeTab === 'session' || activeTab === 'workspace' ? 'files' : activeTab
  const prevTabStateRef = React.useRef<PreviousTabState>({ sessionId: currentSessionId, activeTab: normalizedActiveTab })

  const clearUnseen = React.useCallback((sessionId = currentSessionId) => {
    if (!sessionId) return
    setUnseenMap((prev) => {
      if (prev.get(sessionId) === false) return prev
      const m = new Map(prev)
      m.set(sessionId, false)
      return m
    })
  }, [currentSessionId, setUnseenMap])

  // 同一会话内，从「文件改动」切走时，说明用户已经看过当前改动。
  React.useEffect(() => {
    const previous = prevTabStateRef.current
    if (previous.sessionId === currentSessionId && previous.activeTab === 'changes' && normalizedActiveTab !== 'changes') {
      clearUnseen(currentSessionId)
    }
    prevTabStateRef.current = { sessionId: currentSessionId, activeTab: normalizedActiveTab }
  }, [normalizedActiveTab, currentSessionId, clearUnseen])

  const handleChangesClick = () => {
    clearUnseen()
    if (activeTab !== 'changes') {
      onTabChange('changes')
    }
  }

  return (
    <div className={cn(
      'relative flex flex-shrink-0 tabbar-bg',
      isClassic ? 'h-[34px] items-end' : 'inspector-tabbar h-[40px] items-center px-2',
    )}>
      <div className={cn("absolute inset-0 titlebar-drag-region", isWindows && WINDOW_CONTROLS_INSET_RIGHT)} />
      <div className={cn(
        'relative flex flex-1 titlebar-no-drag',
        isClassic
          ? 'h-[34px] items-end'
          : 'inspector-tabbar-control h-7 items-stretch rounded-lg bg-foreground/[0.04] p-0.5',
      )}>
        <button
          type="button"
          onClick={() => onTabChange('files')}
          className={cn(
            isClassic
              ? 'h-[34px] flex-1 overflow-hidden whitespace-nowrap px-3 text-xs transition-colors select-none cursor-pointer'
              : 'inspector-tab flex-1 overflow-hidden whitespace-nowrap rounded-md px-2 text-[11px] font-medium transition-colors select-none cursor-pointer',
            isClassic ? 'rounded-t-lg' : 'rounded-none',
            'border-t border-l border-r',
            normalizedActiveTab === 'files'
              ? isClassic
                ? 'bg-content-area text-foreground border-border/50'
                : 'app-tab-active text-foreground border-border/80'
              : isClassic
                ? 'text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50'
                : 'app-tab-inactive text-muted-foreground border-transparent hover:text-foreground',
          )}
        >
          相关文件
        </button>
        <button
          type="button"
          onClick={handleChangesClick}
          className={cn(
            isClassic
              ? 'relative h-[34px] flex-1 overflow-hidden whitespace-nowrap px-3 text-xs transition-colors select-none cursor-pointer'
              : 'inspector-tab relative flex-1 overflow-hidden whitespace-nowrap rounded-md px-2 text-[11px] font-medium transition-colors select-none cursor-pointer',
            isClassic ? 'rounded-t-lg' : 'rounded-none',
            'border-t border-l border-r',
            normalizedActiveTab === 'changes'
              ? isClassic
                ? 'bg-content-area text-foreground border-border/50'
                : 'app-tab-active text-foreground border-border/80'
              : isClassic
                ? 'text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50'
                : 'app-tab-inactive text-muted-foreground border-transparent hover:text-foreground',
          )}
        >
          <span className="inline-flex items-center gap-1">
            {unseenChanges && normalizedActiveTab !== 'changes' && (
              <span className="size-2 rounded-full bg-primary ring-1 ring-background shrink-0" />
            )}
            文件改动
          </span>
        </button>
        {showChatTab && (
          <div
            className={cn(
              isClassic
                ? 'relative h-[34px] flex-1 overflow-hidden whitespace-nowrap text-xs transition-colors select-none'
                : 'inspector-tab relative flex-1 overflow-hidden whitespace-nowrap rounded-md text-[11px] font-medium transition-colors select-none',
              isClassic ? 'rounded-t-lg' : 'rounded-none',
              'border-t border-l border-r',
              normalizedActiveTab === 'chat'
                ? isClassic
                  ? 'bg-content-area text-foreground border-border/50'
                  : 'app-tab-active text-foreground border-border/80'
                : isClassic
                  ? 'text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50'
                  : 'app-tab-inactive text-muted-foreground border-transparent hover:text-foreground',
            )}
          >
            <div className="flex h-full items-center">
              <button
                type="button"
                onClick={() => onTabChange('chat')}
                className="min-w-0 flex-1 self-stretch px-2 text-left"
              >
                <span className="block truncate text-center">问答</span>
              </button>
              {onCloseChat && (
                <button
                  type="button"
                  className="mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  aria-label="关闭问答 Tab"
                  onClick={onCloseChat}
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          </div>
        )}
        {/* 本会话已打开的工作区组件 Tab：与问答 Tab 同构（label + icon + 关闭按钮） */}
        {componentTabs.map((componentTab) => {
          const Icon = WORKSPACE_COMPONENT_TAB_ICONS[componentTab]
          const label = WORKSPACE_COMPONENT_TAB_LABELS[componentTab]
          const isComponentActive = normalizedActiveTab === componentTab
          return (
            <div
              key={componentTab}
              className={cn(
                isClassic
                  ? 'relative h-[34px] flex-1 overflow-hidden whitespace-nowrap text-xs transition-colors select-none'
                  : 'inspector-tab relative flex-1 overflow-hidden whitespace-nowrap rounded-md text-[11px] font-medium transition-colors select-none',
                isClassic ? 'rounded-t-lg' : 'rounded-none',
                'border-t border-l border-r',
                isComponentActive
                  ? isClassic
                    ? 'bg-content-area text-foreground border-border/50'
                    : 'app-tab-active text-foreground border-border/80'
                  : isClassic
                    ? 'text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50'
                    : 'app-tab-inactive text-muted-foreground border-transparent hover:text-foreground',
              )}
            >
              <div className="flex h-full items-center">
                <button
                  type="button"
                  title={label}
                  onClick={() => onTabChange(componentTab)}
                  className="flex min-w-0 flex-1 items-center justify-center gap-1 self-stretch px-1 text-center"
                >
                  <Icon className="size-3 shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
                <button
                  type="button"
                  className="mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                  aria-label={`关闭${label} Tab`}
                  onClick={() => closeWorkspaceComponent(componentTab)}
                >
                  <X className="size-3" />
                </button>
              </div>
            </div>
          )
        })}
        {/* 右侧关闭按钮（常驻，三个 tab 下都可见） */}
        {onClose && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onClose}
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground',
                  isClassic ? 'mb-[3px] mr-1' : 'ml-1',
                )}
              >
                <PanelRightClose className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">折叠文件面板 ({navigator.platform.includes('Mac') ? '⌘⇧B' : 'Ctrl+Shift+B'})</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
