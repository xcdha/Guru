import * as React from 'react'
import { useAtomValue } from 'jotai'
import type { Channel } from '@guru/shared'
import { cn } from '@/lib/utils'
import { supportsChannelPlanQuota, fetchChannelPlanQuota, invalidateChannelPlanQuota, channelPlanQuotaRefreshVersionAtom } from '@/lib/channel-plan-quota'
import { currentPlanQuota, getPlanQuotaDisplay, planQuotaChannelKey } from '@/lib/channel-plan-quota-display'
import type { LoadedPlanQuota } from '@/lib/channel-plan-quota-display'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function ChannelPlanQuotaBadge({ channel }: { channel: Channel }): React.ReactElement | null {
  const [loaded, setLoaded] = React.useState<LoadedPlanQuota | null>(null)
  const channelKey = planQuotaChannelKey(channel)

  const refreshVersion = useAtomValue(channelPlanQuotaRefreshVersionAtom)

  React.useEffect(() => {
    if (!supportsChannelPlanQuota(channel)) return

    // 全局刷新触发时主动失效缓存，确保下次 fetch 走实时查询
    invalidateChannelPlanQuota(channel.id)

    let cancelled = false
    fetchChannelPlanQuota(channel.id, channel.updatedAt)
      .then((result) => {
        if (!cancelled) setLoaded({ channelKey, result })
      })

    return () => {
      cancelled = true
    }
  }, [channel.id, channel.provider, channel.baseUrl, channel.updatedAt, refreshVersion, channelKey])

  if (!supportsChannelPlanQuota(channel)) return null

  const quota = currentPlanQuota(loaded, channelKey)

  const isClaudeSubscription = channel.provider === 'anthropic-oauth'
  const isLoading = quota == null
  const hasError = quota != null && !quota.supported

  // Claude Pro/Max 无余额 API，直接显示 ⚠
  if (isClaudeSubscription) {
    return (
      <span
        title={quota?.message ?? 'Claude Pro/Max 订阅额度请在 Claude Code 中运行 /usage 或 /usage-credits 查看'}
        className="ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none border-transparent bg-transparent text-muted-foreground/50"
      >
        ⚠
      </span>
    )
  }

  // 加载中：显示占位符，不静默消失
  if (isLoading) {
    return (
      <span
        className="ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none border-transparent bg-transparent text-muted-foreground/40"
      >
        ...
      </span>
    )
  }

  // 查询失败：显示简短错误信息，hover 看完整原因
  if (hasError) {
    const errorText = quota.message ?? '余额查询失败'
    // 截取前 18 个字符作为缩写，避免 UI 太长
    const shortError = errorText.length > 18 ? `${errorText.slice(0, 16)}…` : errorText
    return (
      <span
        title={errorText}
        className="ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none border-transparent bg-transparent text-muted-foreground/50"
      >
        {shortError}
      </span>
    )
  }

  const display = getPlanQuotaDisplay(quota, channel.provider)
  if (!display) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={display.title}
          className={cn(
            'ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] leading-none outline-none focus-visible:ring-2 focus-visible:ring-ring',
            display.muted
              ? 'border-transparent bg-transparent text-muted-foreground/70'
              : 'border-foreground/10 bg-background/70 text-foreground/70',
          )}
        >
          {display.summary}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm whitespace-pre-line">{display.title}</TooltipContent>
    </Tooltip>
  )
}
