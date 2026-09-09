import { atom } from 'jotai'
import type { Channel, ChannelPlanQuotaResult, ProviderType } from '@guru/shared'

const PLAN_QUOTA_PROVIDERS = new Set<ProviderType>([
  'deepseek',
  'kimi-coding',
  'minimax',
  'zhipu',
  'zhipu-coding',
  'zhipu-coding-team',
  'openai-codex',
  'github-copilot',
  'kimi-api',
  'openrouter',
  'anthropic-oauth',
])

export function supportsChannelPlanQuota(channel: Pick<Channel, 'provider' | 'baseUrl'> | null | undefined): boolean {
  if (!channel) return false
  if (PLAN_QUOTA_PROVIDERS.has(channel.provider)) return true
  return channel.baseUrl.includes('api.kimi.com/coding')
}

const PLAN_QUOTA_CACHE_MS = 60 * 1000
const PLAN_QUOTA_ERROR_CACHE_MS = 15 * 1000

interface CachedPlanQuota {
  result: ChannelPlanQuotaResult
  /** 渠道凭据更新时递增，避免同一 channelId 换号后沿用旧账号额度。 */
  channelUpdatedAt?: number
}

const quotaCache = new Map<string, CachedPlanQuota>()
const inflightRequests = new Map<string, Promise<ChannelPlanQuotaResult>>()
/** 渠道当前凭据版本：缓存写入只在该版本仍是当前版本时生效，避免旧账号结果污染新账号展示。 */
const currentVersions = new Map<string, number | undefined>()

function getCacheTtl(result: ChannelPlanQuotaResult): number {
  return result.supported ? PLAN_QUOTA_CACHE_MS : PLAN_QUOTA_ERROR_CACHE_MS
}

export function getCachedPlanQuota(channelId: string, channelUpdatedAt?: number): ChannelPlanQuotaResult | null {
  const cached = quotaCache.get(channelId)
  if (!cached || cached.channelUpdatedAt !== channelUpdatedAt) return null
  if (Date.now() - cached.result.updatedAt >= getCacheTtl(cached.result)) return null
  return cached.result
}

export async function fetchChannelPlanQuota(
  channelId: string,
  channelUpdatedAt?: number,
): Promise<ChannelPlanQuotaResult> {
  currentVersions.set(channelId, channelUpdatedAt)
  const cached = getCachedPlanQuota(channelId, channelUpdatedAt)
  if (cached) return cached
  quotaCache.delete(channelId)

  // 同一渠道换号后不能复用旧凭据发起的 in-flight 请求。
  const requestKey = `${channelId}:${channelUpdatedAt ?? ''}`
  const inflight = inflightRequests.get(requestKey)
  if (inflight) return inflight

  // 仅当查询完成时该渠道仍是同一凭据版本才写入缓存，过期结果直接丢弃。
  const cacheIfCurrent = (result: ChannelPlanQuotaResult): ChannelPlanQuotaResult => {
    if (currentVersions.get(channelId) === channelUpdatedAt) {
      quotaCache.set(channelId, { result, channelUpdatedAt })
    }
    return result
  }

  const request = Promise.resolve()
    .then(() => window.electronAPI.getChannelPlanQuota(channelId))
    .then(cacheIfCurrent)
    .catch(() => {
      // 不向上层透传 IPC/主进程错误细节，统一收敛为用户可读提示。
      const result: ChannelPlanQuotaResult = {
        supported: false,
        provider: 'custom',
        windows: [],
        updatedAt: Date.now(),
        message: '订阅额度查询失败，请稍后重试',
      }
      return cacheIfCurrent(result)
    })
    .finally(() => {
      inflightRequests.delete(requestKey)
    })

  inflightRequests.set(requestKey, request)
  return request
}

/**
 * 全局刷新版本号 —— 流式响应结束时递增，驱动 ChannelPlanQuotaBadge 重新查询余额。
 */
export const channelPlanQuotaRefreshVersionAtom = atom<number>(0)

/**
 * 主动失效指定渠道的额度缓存，使下一次 fetchChannelPlanQuota 绕过缓存。
 */
export function invalidateChannelPlanQuota(channelId: string): void {
  quotaCache.delete(channelId)
}
