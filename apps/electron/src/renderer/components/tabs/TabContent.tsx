/**
 * TabContent — 标签内容渲染器
 *
 * 根据标签类型渲染参数化的 ChatView 或 AgentView。
 * 直接传递 sessionId/conversationId prop，无需桥接全局 atoms。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { tabsAtom } from '@/atoms/tab-atoms'
import { ChatView } from '@/components/chat'
import { AgentView } from '@/components/agent'
import { cn } from '@/lib/utils'
import { TabErrorBoundary } from './TabErrorBoundary'

// 预览类标签按需加载：PreviewTabContent → DiffTabContent 会连带引入
// MarkdownRichEditor / katex / @pierre/diffs / dompurify 等重依赖，
// 而这些只在用户打开预览标签时才用得到，不应计入首屏入口包。
const PreviewTabContent = React.lazy(() =>
  import('@/components/diff/PreviewTabContent').then((m) => ({ default: m.PreviewTabContent })),
)
const GuideView = React.lazy(() =>
  import('@/components/tutorial/GuideView').then((m) => ({ default: m.GuideView })),
)

/** 按需 chunk 加载中的占位（本地磁盘加载，通常一闪而过） */
function TabChunkFallback(): React.ReactElement {
  return <div className="h-full min-h-0 animate-pulse bg-muted/30" />
}

const AGENT_SESSION_TRANSITION_MS = 140

/**
 * 切换时立即挂载新会话（不保留旧会话），只给新内容一段短暂进入过渡。
 * 仅合成 opacity，避免为整段对话测量高度或触发布局动画。
 */
function AgentSessionTransition({ children, animate }: { children: React.ReactNode; animate: boolean }): React.ReactElement {
  const [entered, setEntered] = React.useState(!animate)

  React.useEffect(() => {
    if (!animate) {
      setEntered(true)
      return
    }
    const frameId = window.requestAnimationFrame(() => setEntered(true))
    return () => window.cancelAnimationFrame(frameId)
  }, [animate])

  return (
    <div
      className={cn(
        'h-full min-h-0 transition-opacity ease-out motion-reduce:transition-none',
        entered ? 'opacity-100' : 'opacity-0',
      )}
      style={{ transitionDuration: `${AGENT_SESSION_TRANSITION_MS}ms` }}
    >
      {children}
    </div>
  )
}

export interface TabContentProps {
  tabId: string
}

function TabContentView({ tabId }: TabContentProps): React.ReactElement {
  const tabs = useAtomValue(tabsAtom)
  const tab = tabs.find((t) => t.id === tabId)
  const hasShownAgentSessionRef = React.useRef(false)
  const shouldAnimateAgentSession = tab?.type === 'agent' && hasShownAgentSessionRef.current

  React.useEffect(() => {
    if (tab?.type === 'agent') hasShownAgentSessionRef.current = true
  }, [tab?.sessionId, tab?.type])

  // 监控 tab 查找失败（说明 tabId 指向了不存在的标签，属异常路径）
  React.useEffect(() => {
    if (!tab) {
      console.warn(`[TabContent] tab not found for tabId="${tabId}"`, { tabIds: tabs.map(t => t.id) })
    }
  }, [tab, tabId, tabs])

  if (!tab) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        标签页不存在
      </div>
    )
  }


  if (tab.type === 'tutorial') {
    return (
      <React.Suspense fallback={<TabChunkFallback />}>
        <TutorialTabContent />
      </React.Suspense>
    )
  }

  if (tab.type === 'chat') {
    return (
      <TabErrorBoundary key={tab.sessionId} sessionId={tab.sessionId}>
        <ChatView conversationId={tab.sessionId} />
      </TabErrorBoundary>
    )
  }

  if (tab.type === 'preview') {
    return (
      <React.Suspense fallback={<TabChunkFallback />}>
        <TabErrorBoundary key={tab.id} sessionId={tab.sessionId}>
          <PreviewTabContent sessionId={tab.sessionId} />
        </TabErrorBoundary>
      </React.Suspense>
    )
  }

  return (
    <AgentSessionTransition key={tab.sessionId} animate={shouldAnimateAgentSession}>
      <TabErrorBoundary sessionId={tab.sessionId}>
        <AgentView sessionId={tab.sessionId} />
      </TabErrorBoundary>
    </AgentSessionTransition>
  )
}

export const TabContent = React.memo(TabContentView)

function TutorialTabContent(): React.ReactElement {
  return <GuideView />
}
