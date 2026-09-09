import type { Channel, ChannelPlanQuotaResult, ChannelPlanQuotaWindow, ProviderType } from '@guru/shared'

export interface LoadedPlanQuota {
  channelKey: string
  result: ChannelPlanQuotaResult
}

export function planQuotaAccountKey(channelId?: string | null, updatedAt?: number): string | null {
  return channelId ? JSON.stringify([channelId, updatedAt]) : null
}

export function currentPlanQuota(loaded: LoadedPlanQuota | null, channelKey: string | null): ChannelPlanQuotaResult | null {
  return channelKey !== null && loaded?.channelKey === channelKey ? loaded.result : null
}

interface PlanQuotaDisplay {
  summary: string
  title: string
  muted: boolean
}

/** 显示状态必须与凭据版本绑定，不能在 effect 执行前闪现旧账号结果。 */
export function planQuotaChannelKey(channel: Pick<Channel, 'id' | 'updatedAt' | 'provider' | 'baseUrl'>): string {
  return JSON.stringify([channel.id, channel.updatedAt, channel.provider, channel.baseUrl])
}

function formatWindow(window: ChannelPlanQuotaWindow): string {
  const label = window.type === '5h' ? '5H' : window.type === 'weekly' ? '周' : window.label.replace(/\s+/g, '')
  return `${label} ${window.remainingLabel ?? `${window.remainingPercent}%`}`
}

export function formatPlanQuotaWindowValue(window: ChannelPlanQuotaWindow, provider: ProviderType): string {
  const date = window.resetAt === undefined ? undefined : new Date(window.resetAt)
  const reset = date && Number.isFinite(date.getTime())
    ? `，重置 ${new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    }).format(date)}`
    : provider === 'github-copilot' ? '，未提供重置时间' : ''
  const value = window.remainingLabel ?? `${window.remainingPercent}%`
  return `${window.showProgress === false ? value : `剩余 ${value}`}${reset}`
}

/**
 * 摘要主窗口优先级。
 * Copilot 照上游只取 5h/周；本地其余订阅（如智谱月度额度窗口 type:'monthly'）沿用
 * 本地 buildQuotaSummary 的 [5h, weekly, monthly] 顺序。
 */
function primaryWindows(quota: ChannelPlanQuotaResult, provider: ProviderType): ChannelPlanQuotaWindow[] {
  const copilot = provider === 'github-copilot'
  const candidates = copilot ? ['5h', 'weekly'] : ['5h', 'weekly', 'monthly']
  return candidates
    .map((type) => quota.windows.find((window) => window.type === type))
    .filter((window): window is ChannelPlanQuotaWindow => Boolean(window))
}

export function getPlanQuotaDisplay(quota: ChannelPlanQuotaResult | null, provider: ProviderType): PlanQuotaDisplay | null {
  const copilot = provider === 'github-copilot'
  if (!quota) return copilot ? { summary: '额度加载中', title: '正在读取 GitHub Copilot 订阅额度', muted: true } : null
  if (!quota.supported || quota.windows.length === 0) {
    return copilot ? {
      summary: quota.supported ? '额度未知' : '额度不可用',
      title: quota.message ?? 'GitHub Copilot 未提供可用额度数据',
      muted: true,
    } : null
  }

  const primary = primaryWindows(quota, provider)
  const summary = (primary.length > 0 ? primary : quota.windows.slice(0, 2)).map(formatWindow).join(' · ')
  const details = quota.windows.map((window) => `${window.label}: ${formatPlanQuotaWindowValue(window, provider)}`).join('\n')
  return { summary, title: `${quota.planName ?? '订阅额度'}\n${details}`, muted: false }
}
