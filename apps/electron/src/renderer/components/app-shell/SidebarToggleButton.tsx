/**
 * SidebarToggleButton — 折叠/展开左侧边栏（共享组件）
 *
 * 对齐 Codex / macOS Finder 心智：
 * - 侧边栏**展开**时，按钮渲染在 LeftSidebar 顶部红绿灯行右端（见 LeftSidebar.tsx）
 * - 侧边栏**收起**时，按钮渲染在 TabBar 最左（红绿灯右侧，见 TabBar.tsx）
 * 同一时刻只出现一处；⌘B 快捷键逻辑在 GlobalShortcuts.tsx，与本按钮解耦。
 *
 * 纯点击切换，无悬停自动预览（历史上悬停浮层被 z-index portal 抢事件等问题反复卡住，
 * 权衡后只保留最简单可靠的点击展开/收起，同 VS Code）。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { sidebarCollapsedAtom } from '@/atoms/tab-atoms'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ShortcutKeycaps } from '@/components/shortcuts/ShortcutKeycaps'
import { getActiveAccelerator, getAcceleratorDisplay } from '@/lib/shortcut-registry'
import { cn } from '@/lib/utils'

export function SidebarToggleButton({ className }: { className?: string }): React.ReactElement {
  const [sidebarCollapsed, setSidebarCollapsed] = useAtom(sidebarCollapsedAtom)
  // 快捷键展示走快捷键注册表：改键后提示与 aria-label 立即同步，
  // 并与侧栏其他控件的键帽提示保持同一样式（不再硬编码 ⌘B / Ctrl+Shift+E）。
  const accelerator = getActiveAccelerator('toggle-sidebar')
  const shortcutDisplay = accelerator ? getAcceleratorDisplay(accelerator) : ''
  const label = sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'
  const ariaLabel = shortcutDisplay ? `${label} (${shortcutDisplay})` : label

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={ariaLabel}
          className={cn('relative h-7 w-7 titlebar-no-drag', className)}
          onClick={() => setSidebarCollapsed((prev) => !prev)}
        >
          {sidebarCollapsed ? <PanelLeftOpen className="size-3.5" /> : <PanelLeftClose className="size-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span className="flex items-center gap-2">
          <span>{label}</span>
          <ShortcutKeycaps
            shortcutId="toggle-sidebar"
            keycapClassName="h-5 min-w-5 px-1 text-[11px]"
            separatorClassName="text-[10px]"
          />
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
