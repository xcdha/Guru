/**
 * IntegrationCatalog — 集成目录卡片墙
 *
 * 上游（Proma）的「完整集成目录」：MCP / CLI / 引导式 / 单凭据 四类条目统一以卡片呈现。
 * 本地差异：
 * - 本地没有 CLI 探测能力（无 CLI integration status channel），因此 CLI 条目不渲染
 *   「检测中 / 暂无法检测 / 已连接」三态，统一按「未配置 + 让 Agent 配置」的引导语义呈现，
 *   与 guided 条目共用同一渲染分支。
 * - 其余状态（MCP 已连接 / 待授权 / 未配置）完全复用本地既有的安装与验证结果。
 */

import * as React from 'react'
import { ChartCandlestick, Check, CircleDashed, Cloud, FileText, Mail, Orbit, Plane, Search, Terminal, TrendingUp } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import tavilyIcon from '@/assets/integrations/tavily.png'
import braveIcon from '@/assets/integrations/brave.svg'
import exaIcon from '@/assets/integrations/exa.png'
import tongdaxinIcon from '@/assets/integrations/tongdaxin.png'
import qichachaIcon from '@/assets/integrations/qichacha.png'
import tencentDocsIcon from '@/assets/integrations/tencent-docs.png'
import wecomIcon from '@/assets/integrations/wecom.png'
import dingtalkIcon from '@/assets/integrations/dingtalk.png'
import ctripIcon from '@/assets/integrations/ctrip.png'
import baiduNetdiskIcon from '@/assets/integrations/baidu-netdisk.png'
import feishuIcon from '@/assets/bots/feishu.png'
import { cn } from '@/lib/utils'
import { compareCatalogConnectionCards, getCatalogGuidedConnectionStatus, getCatalogMcpConnectionStatus, getCatalogMcpStatusRank, type CatalogCliIntegration, type CatalogCredentialIntegration, type CatalogGuidedIntegration, type CatalogMcpIntegration } from './integration-catalog'

interface IntegrationCatalogProps {
  mcps: CatalogMcpIntegration[]
  clis: CatalogCliIntegration[]
  guided: CatalogGuidedIntegration[]
  credentials: CatalogCredentialIntegration[]
  embedded: boolean
  installedMcpNames: Set<string>
  enabledMcpNames: Set<string>
  verifiedMcpNames: Set<string>
  activeSkillSlugs: Set<string>
  installingMcpId: string | null
  onInstallMcp: (integration: CatalogMcpIntegration) => void
  /** CLI 无探测能力：点击即走「让 Agent 按官方文档配置」的引导 */
  onGuideCli: (integration: CatalogCliIntegration) => void
  onGuide: (integration: CatalogGuidedIntegration) => void
  onRequestCredential: (integration: CatalogCredentialIntegration) => void
  onToggleMcp: (serverName: string, enabled: boolean) => void
}

// The normal capability center keeps its viewport breakpoint. The embedded view
// is inside a resizable SidePanel, so it switches columns from its own container.
export const EMBEDDED_CATALOG_TWO_COLUMN_MIN_WIDTH = '40rem'
const embeddedCatalogContainerQuery = `
  @container (min-width: ${EMBEDDED_CATALOG_TWO_COLUMN_MIN_WIDTH}) {
    .integration-catalog-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
`

interface CatalogCard {
  integration: CatalogMcpIntegration | CatalogCliIntegration | CatalogGuidedIntegration | CatalogCredentialIntegration
  status: string
  statusTone: 'success' | 'muted'
  statusRank: number
  actionLabel: string
  primaryActionLabel?: string
  commandLine: boolean
  enabled?: boolean
  onAction: () => void
  onToggle?: (enabled: boolean) => void
}

export function IntegrationCatalog({ mcps, clis, guided, credentials, embedded, installedMcpNames, enabledMcpNames, verifiedMcpNames, activeSkillSlugs, installingMcpId, onInstallMcp, onGuideCli, onGuide, onRequestCredential, onToggleMcp }: IntegrationCatalogProps): React.ReactElement {
  const cards: CatalogCard[] = [
    ...mcps.map((integration) => {
      const status = getCatalogMcpConnectionStatus(integration.serverName, installedMcpNames, enabledMcpNames, verifiedMcpNames)
      return {
        integration,
        status: status === 'connected' ? '已连接' : status === 'pending' ? '待授权' : '未配置',
        statusTone: status === 'connected' ? 'success' as const : 'muted' as const,
        statusRank: getCatalogMcpStatusRank(status),
        actionLabel: status === 'connected' ? `查看 ${integration.name}` : status === 'pending' ? `继续配置 ${integration.name}` : `连接 ${integration.name}`,
        commandLine: false as const,
        enabled: enabledMcpNames.has(integration.serverName),
        onAction: () => onInstallMcp(integration),
        onToggle: status !== 'unconfigured' ? (enabled: boolean) => onToggleMcp(integration.serverName, enabled) : undefined,
      }
    }),
    ...guided.map((integration) => {
      const serverName = integration.serverName
      const status = getCatalogGuidedConnectionStatus(integration, activeSkillSlugs, installedMcpNames, enabledMcpNames, verifiedMcpNames)
      const skillAvailable = status === 'skill-available'
      const connected = status === 'connected'
      return {
        integration,
        status: skillAvailable ? 'Skill 已安装' : connected ? '已连接' : status === 'pending' ? '待授权' : '未配置',
        statusTone: skillAvailable || connected ? 'success' as const : 'muted' as const,
        statusRank: skillAvailable || connected
          ? getCatalogMcpStatusRank('connected')
          : getCatalogMcpStatusRank(status === 'pending' ? 'pending' : 'unconfigured'),
        actionLabel: skillAvailable ? `查看/使用 ${integration.name}` : connected ? `查看 ${integration.name}` : status === 'pending' ? `继续配置 ${integration.name}` : `开始配置 ${integration.name}`,
        commandLine: false as const,
        enabled: Boolean(serverName && enabledMcpNames.has(serverName)),
        onAction: () => onGuide(integration),
        onToggle: connected && serverName ? (enabled: boolean) => onToggleMcp(serverName, enabled) : undefined,
      }
    }),
    ...credentials.map((integration) => {
      const status = getCatalogMcpConnectionStatus(integration.serverName, installedMcpNames, enabledMcpNames, verifiedMcpNames)
      return {
        integration,
        status: status === 'connected' ? '已连接' : status === 'pending' ? '待授权' : '未配置',
        statusTone: status === 'connected' ? 'success' as const : 'muted' as const,
        statusRank: getCatalogMcpStatusRank(status),
        actionLabel: `配置 ${integration.name}`,
        primaryActionLabel: '配置',
        commandLine: false as const,
        enabled: enabledMcpNames.has(integration.serverName),
        onAction: () => onRequestCredential(integration),
        onToggle: status !== 'unconfigured' ? (enabled: boolean) => onToggleMcp(integration.serverName, enabled) : undefined,
      }
    }),
    // 本地无 CLI 探测：CLI 条目与 guided 一致，按「未配置 + 引导」呈现。
    // 排序优先级仍使用条目自带的 priority，因此飞书/钉钉/企业微信仍在目录前三位。
    ...clis.map((integration) => ({
      integration,
      status: '未配置',
      statusTone: 'muted' as const,
      statusRank: getCatalogMcpStatusRank('unconfigured'),
      actionLabel: `配置 ${integration.name}`,
      commandLine: true as const,
      onAction: () => onGuideCli(integration),
    })),
  ].sort((left, right) => compareCatalogConnectionCards(
    { placement: left.integration.placement, featured: left.integration.featured, priority: left.integration.priority, statusRank: left.statusRank },
    { placement: right.integration.placement, featured: right.integration.featured, priority: right.integration.priority, statusRank: right.statusRank },
  ))

  if (cards.length === 0) return <></>

  return (
    <section className="flex flex-col gap-4">
      {embedded && <style>{embeddedCatalogContainerQuery}</style>}
      <div className="px-1">
        <div className="flex items-center gap-2.5">
          <h2 className="text-[15px] font-semibold text-foreground">集成目录</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-foreground/45">{cards.length}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">选择服务后按提示完成授权、安装或配置。</p>
      </div>
      <div className={cn('grid grid-cols-1 gap-4', embedded ? 'integration-catalog-grid' : 'md:grid-cols-2')}>
        {cards.map((card) => (
          <IntegrationCard
            key={card.integration.id}
            name={card.integration.name}
            description={card.integration.description}
            capabilities={card.integration.capabilities}
            iconSlug={card.integration.iconSlug}
            status={card.status}
            statusTone={card.statusTone}
            actionLabel={card.actionLabel}
            primaryActionLabel={card.primaryActionLabel}
            installing={'serverName' in card.integration && installingMcpId === card.integration.id}
            commandLine={card.commandLine}
            onAction={card.onAction}
            onToggle={card.onToggle}
            enabled={card.enabled}
          />
        ))}
      </div>
    </section>
  )
}

interface IntegrationCardProps {
  name: string
  description: string
  capabilities: string[]
  iconSlug: string
  status: string
  statusTone: 'success' | 'muted'
  actionLabel: string
  primaryActionLabel?: string
  installing: boolean
  commandLine: boolean
  onAction: () => void
  enabled?: boolean
  onToggle?: (enabled: boolean) => void
}

function IntegrationCard({ name, description, capabilities, iconSlug, status, statusTone, actionLabel, primaryActionLabel, installing, commandLine, onAction, enabled, onToggle }: IntegrationCardProps): React.ReactElement {
  const [iconFailed, setIconFailed] = React.useState(false)
  const actionText = primaryActionLabel ?? (status === '待授权'
    ? '继续配置'
    : status === '未配置'
      ? (commandLine ? '配置' : '连接')
      : status === 'Skill 已安装'
        ? '使用'
        : '查看')
  const DomainIcon = {
    'lucide-orbit': Orbit,
    'lucide-plane': Plane,
    'lucide-chart-candlestick': ChartCandlestick,
    'lucide-trending-up': TrendingUp,
    'lucide-cloud': Cloud,
    'lucide-file-text': FileText,
    'lucide-mail': Mail,
    'lucide-search': Search,
  }[iconSlug]

  const localIcon = {
    'asset:brave': braveIcon,
    'asset:tavily': tavilyIcon,
    'asset:exa': exaIcon,
    'asset:tongdaxin': tongdaxinIcon,
    'asset:baidu-netdisk': baiduNetdiskIcon,
    'asset:tencent-docs': tencentDocsIcon,
    'asset:wecom': wecomIcon,
    'asset:feishu': feishuIcon,
    'asset:qichacha': qichachaIcon,
    'asset:dingtalk': dingtalkIcon,
    'asset:ctrip': ctripIcon,
  }[iconSlug]
  const imageIconSizeClass = iconSlug === 'asset:feishu' ? 'size-[34px]' : 'size-7'

  return (
    <article className={cn(
      'group relative flex min-h-[144px] flex-col gap-2 rounded-lg bg-card p-3 text-left shadow-md',
    )}>
      <div className="flex items-start gap-2">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {localIcon
            ? <img className={cn(imageIconSizeClass, 'object-contain')} src={localIcon} alt="" />
            : DomainIcon
              ? <DomainIcon size={28} strokeWidth={1.8} />
              : iconFailed
                ? commandLine
                  ? <Terminal size={28} className="text-muted-foreground" />
                  : <CircleDashed size={28} className="text-muted-foreground" />
                : <img className="size-7 object-contain" src={`https://cdn.simpleicons.org/${iconSlug}`} alt="" onError={() => setIconFailed(true)} />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold text-foreground [text-wrap:balance]">{name}</h3>
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-muted-foreground">{description}</p>
        </div>
      </div>

      <div className="mt-1 flex flex-wrap gap-1">
        {capabilities.map((capability) => (
          <span key={capability} className="rounded-md bg-foreground/[0.045] px-1.5 py-0.5 text-[11px] text-foreground/60">{capability}</span>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-1.5 pt-1.5">
        <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium', statusTone === 'success' ? 'text-primary' : 'text-muted-foreground')}>
          {statusTone === 'success' ? <Check size={12} strokeWidth={2.5} /> : <CircleDashed size={12} />}
          <span className="truncate">{status}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          {onToggle && enabled !== undefined && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">启用</span>
              <Switch
                checked={enabled}
                disabled={installing}
                onCheckedChange={onToggle}
                aria-label={`启用 ${name}`}
                className="scale-90"
              />
            </div>
          )}
          <button type="button" title={actionLabel} aria-label={actionLabel} disabled={installing} onClick={onAction} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-primary px-2 text-[11px] font-medium text-primary-foreground shadow-sm transition-[transform,background-color,box-shadow] hover:bg-primary/90 hover:shadow active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60">
            {installing ? <CircleDashed size={14} className="animate-spin" /> : <span>{actionText}</span>}
          </button>
        </div>
      </div>
    </article>
  )
}
