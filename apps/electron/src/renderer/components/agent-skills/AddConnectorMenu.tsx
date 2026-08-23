/**
 * AddConnectorMenu — 「添加连接器」下拉：本地/远程服务 或 自定义 HTTP。
 * 不假装能从市场安装 GitHub/Notion。
 *
 * 实现说明：早期用 Radix DropdownMenu，用户环境反馈点击后菜单不出现
 * （portal 渲染链路不可控）。改为本地 state + 绝对定位弹出层，
 * 视觉样式与原 DropdownMenuContent 一致，行为完全确定性。
 */

import * as React from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AddConnectorMenuProps {
  onAddMcp: () => void
  onAddHttp: () => void
  className?: string
}

export function AddConnectorMenu({
  onAddMcp,
  onAddHttp,
  className,
}: AddConnectorMenuProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)

  // 点击外部 / Esc 关闭
  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-state={open ? 'open' : 'closed'}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground shadow-sm',
          'transition-[background-color,transform] duration-fast ease-out hover:bg-primary/90 active:scale-[var(--press-scale)]',
        )}
      >
        <Plus size={14} />
        <span>添加连接器</span>
        <ChevronDown size={12} className={cn('transition-transform duration-fast', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[8rem] overflow-hidden rounded-lg border border-border/50 bg-popover p-1 text-popover-foreground shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onAddMcp() }}
            className="flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors focus:bg-accent hover:bg-accent"
          >
            本地或远程服务
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onAddHttp() }}
            className="flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors focus:bg-accent hover:bg-accent"
          >
            自定义 HTTP
          </button>
        </div>
      )}
    </div>
  )
}
