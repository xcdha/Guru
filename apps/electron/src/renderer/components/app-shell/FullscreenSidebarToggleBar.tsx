/**
 * FullscreenSidebarToggleBar — 全屏视图下的侧边栏展开条
 *
 * 背景：Yoda 插件 / Yoda 记忆 / 知识库 / 画布 / 浏览器等全屏视图会替换 TabBar + TabContent。
 * 侧边栏收起后，TabBar（唯一放展开按钮的地方）不在渲染，用户将无法返回其他页面。
 *
 * 本组件在收起态下渲染一条与 TabBar 等高的顶栏（34px），左侧放置展开侧边栏按钮，
 * 与普通视图下"侧栏收起后 TabBar 最左出现展开按钮"的交互完全一致；
 * 同时保留 macOS 红绿灯避让与标题栏拖拽区，视觉上等价于"TabBar 只留下了展开按钮"。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { sidebarCollapsedAtom } from '@/atoms/tab-atoms'
import { SidebarToggleButton } from '@/components/app-shell/SidebarToggleButton'
import { detectIsMac, detectIsWindows, MAC_TRAFFIC_LIGHTS_PADDING_LEFT } from '@/lib/platform'
import { cn } from '@/lib/utils'

function useIsMacFullscreen(): boolean {
  const [isFullscreen, setIsFullscreen] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    const check = (): void => {
      const api = window.electronAPI as typeof window.electronAPI & {
        windowIsFullScreen?: () => Promise<boolean>
      }
      if (typeof api.windowIsFullScreen === 'function') {
        api.windowIsFullScreen()
          .then((next) => {
            if (!cancelled) setIsFullscreen(next)
          })
          .catch(() => {
            if (!cancelled) setIsFullscreen(window.outerHeight >= screen.height - 1)
          })
        return
      }
      setIsFullscreen(window.outerHeight >= screen.height - 1)
    }
    check()
    const unsub = window.electronAPI?.onWindowResize?.(check)
    window.addEventListener('resize', check)
    return () => {
      cancelled = true
      unsub?.()
      window.removeEventListener('resize', check)
    }
  }, [])

  return isFullscreen
}

export function FullscreenSidebarToggleBar(): React.ReactElement | null {
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom)
  const isMac = React.useMemo(() => detectIsMac(), [])
  const isWindows = React.useMemo(() => detectIsWindows(), [])
  const isMacFullscreen = useIsMacFullscreen()

  // 是否渲染由 MainArea 的调用条件决定（仅普通对话页不调用）。
  // 组件内部**不能**再按 activeView 排除——看板（task-board）的 activeView 也是
  // 'conversations'，若在此排除会导致看板收起侧栏后无展开条（9b6db857 教训）。
  if (!sidebarCollapsed) return null

  // 侧边栏完全隐藏后顶栏贴到窗口最左，需要避让 macOS 原生红绿灯（与 TabBar 收起态一致）
  const needsMacTrafficLightGap = isMac && sidebarCollapsed && !isMacFullscreen

  return (
    <div
      className={cn(
        'h-[34px] flex items-center titlebar-drag-region border-b border-border/60',
        needsMacTrafficLightGap && MAC_TRAFFIC_LIGHTS_PADDING_LEFT,
        // Windows 上展开条是全宽拖拽区，必须避让右上角 WindowControls（最小化/最大化/关闭），
        // 否则原生 drag-region 的 hitmask 会与按钮区重叠，导致按钮点击被吞为标题栏拖拽。
        // 注意：展开条是 flex 布局容器（非 absolute），right-[126px] 无效，
        // 必须用 margin-right 让出右缘（与看板顶栏 KanbanBoardContainer 同方案）。
        isWindows && 'mr-[126px]',
      )}
    >
      <SidebarToggleButton />
      <span className="pl-1 text-[11px] text-muted-foreground select-none">展开侧边栏</span>
    </div>
  )
}
