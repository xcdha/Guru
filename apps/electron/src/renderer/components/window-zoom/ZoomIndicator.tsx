/**
 * 缩放百分比指示器
 *
 * 监听主进程广播的 zoomFactor 变化（Ctrl+=/Ctrl+-/Ctrl+0、菜单缩放、滚轮缩放），
 * 在右下角短暂显示当前缩放百分比（100% / 105% / 95% …），2 秒后自动淡出。
 * 100% 时也显示一次"已重置为 100%"确认反馈。
 */

import * as React from 'react'

const HIDE_AFTER_MS = 1500
const FADE_MS = 180

export function ZoomIndicator(): React.ReactElement {
  const [percent, setPercent] = React.useState<number | null>(null)
  const [visible, setVisible] = React.useState(false)
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const showPercent = React.useCallback((factor: number): void => {
    const next = Math.round(factor * 100)
    setPercent(next)
    setVisible(true)

    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      setVisible(false)
      fadeTimerRef.current = setTimeout(() => setPercent(null), FADE_MS)
    }, HIDE_AFTER_MS)
  }, [])

  // 订阅主进程 zoomFactor 广播；挂载时先读一次当前值（但不主动显示）
  React.useEffect(() => {
    let disposed = false
    const unsubscribe = window.electronAPI.onZoomFactorChange((factor) => {
      if (!disposed) showPercent(factor)
    })
    return () => {
      disposed = true
      unsubscribe()
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current)
    }
  }, [showPercent])

  if (percent === null) return <span />

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed bottom-6 left-1/2 z-[200] -translate-x-1/2 transition-opacity duration-[180ms] ease-out ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div className="rounded-full border border-border/70 bg-background/90 px-3 py-1 text-[12px] font-medium tabular-nums text-foreground/80 shadow-[0_4px_20px_rgba(0,0,0,0.18)] backdrop-blur-sm titlebar-no-drag">
        {percent}%
      </div>
    </div>
  )
}
