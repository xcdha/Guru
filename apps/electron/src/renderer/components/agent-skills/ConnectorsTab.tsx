/**
 * ConnectorsTab — 连接器（对标小米 Mico / PR #105）
 *
 * 顶部：作用域说明 + 需配置引导；分类/生命周期 chip；主体按品类分块的卡片网格。
 * 卡片不暴露 MCP/API；详情统一走居中 ConnectorDetailDialog。
 * 「添加连接器」下拉：本地/远程服务（MCP 表单）或自定义 HTTP。已有连接的编辑在详情弹层内完成。
 * 末尾「集成目录」：上游 IntegrationCatalog 的可见条目，提供安装/凭据/引导三类接入动作。
 */

import * as React from 'react'
import { AlertTriangle, ArrowRight, Globe, Plus, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAtomValue, useSetAtom } from 'jotai'
import { chatToolsAtom } from '@/atoms/chat-tool-atoms'
import { agentPendingPromptAtom } from '@/atoms/agent-atoms'
import { useCreateSession } from '@/hooks/useCreateSession'
import { cn } from '@/lib/utils'
import {
  buildConnectorItems,
  CONNECTOR_FILTER_CHIPS,
  filterConnectorItems,
  groupConnectorItems,
  isConnectorAttentionStatus,
  type ConnectorFilterChip,
  type ConnectorItem,
} from '@/lib/connectors-model'
import type { BuiltinMcpServerSummary, GlobalScopeReviewHints, McpServerEntry } from '@guru/shared'
import { ConnectorCard } from './ConnectorCard'
import { ConnectorDetailDialog } from './ConnectorDetailDialog'
import { AddConnectorMenu } from './AddConnectorMenu'
import { CredentialDialog } from './CredentialDialog'
import { IntegrationCatalog } from './IntegrationCatalog'
import {
  MCP_INTEGRATION_CATALOG,
  isCatalogIntegrationVisible,
  matchesCatalogSearch,
  type CatalogCliIntegration,
  type CatalogCredentialIntegration,
  type CatalogGuidedIntegration,
  type CatalogMcpIntegration,
} from './integration-catalog'

/** 未提供 activeSkillSlugs 时的稳定空集合（避免每次渲染新建 Set 触发子组件重算）。 */
const EMPTY_SKILL_SLUGS = new Set<string>()

interface ConnectorsTabProps {
  builtinServers: BuiltinMcpServerSummary[]
  userEntries: Array<[string, McpServerEntry]>
  query: string
  reviewHints: GlobalScopeReviewHints | null
  onDismissHints: () => void
  onAddMcp: () => void
  onAddHttp: () => void
  onToggleBuiltin: (id: string, enabled: boolean) => Promise<void> | void
  onToggleMcp: (name: string, enabled: boolean) => Promise<void> | void
  workspaceSlug: string
  projectId?: string | null
  /** 已启用的 Skill slug 集合：供引导类集成的「Skill 已安装」状态使用 */
  activeSkillSlugs?: Set<string>
  onUserMcpChanged?: () => void
  /** 要自动打开的连接器完整 id（带 kind 命名空间，如 builtin:chrome-devtools） */
  openConnectorId?: string | null
  onOpenConnectorConsumed?: () => void
  onRequestDeleteMcp?: (name: string) => void
  onRequestDeleteHttp?: (item: { id: string; name: string }) => void
}

export function ConnectorsTab({
  builtinServers,
  userEntries,
  query,
  reviewHints,
  onDismissHints,
  onAddMcp,
  onAddHttp,
  onToggleBuiltin,
  onToggleMcp,
  workspaceSlug,
  projectId,
  activeSkillSlugs,
  onUserMcpChanged,
  openConnectorId,
  onOpenConnectorConsumed,
  onRequestDeleteMcp,
  onRequestDeleteHttp,
}: ConnectorsTabProps): React.ReactElement {
  const chatTools = useAtomValue(chatToolsAtom)
  const setChatTools = useSetAtom(chatToolsAtom)
  const [toolsFetchDone, setToolsFetchDone] = React.useState(chatTools.length > 0)

  React.useEffect(() => {
    if (chatTools.length > 0) {
      setToolsFetchDone(true)
      return
    }
    let cancelled = false
    void window.electronAPI.getChatTools()
      .then((tools) => {
        if (!cancelled) setChatTools(tools)
      })
      .catch((error) => {
        console.error('[连接器] 加载工具列表失败:', error)
      })
      .finally(() => {
        if (!cancelled) setToolsFetchDone(true)
      })
    return () => {
      cancelled = true
    }
  }, [chatTools.length, setChatTools])
  const [selected, setSelected] = React.useState<ConnectorItem | null>(null)
  const [chip, setChip] = React.useState<ConnectorFilterChip>('all')
  // ===== 集成目录（上游 IntegrationCatalog 移植）状态 =====
  const { createAgent } = useCreateSession()
  const setPendingPrompt = useSetAtom(agentPendingPromptAtom)
  const [installingCatalogId, setInstallingCatalogId] = React.useState<string | null>(null)
  const [credentialRequest, setCredentialRequest] = React.useState<CatalogCredentialIntegration | null>(null)
  /** 安装后等「我的连接」刷新出该 MCP，再自动打开详情（如 OAuth 条目需要用户继续授权）。 */
  const [pendingOpenMcpName, setPendingOpenMcpName] = React.useState<string | null>(null)

  const items = React.useMemo(
    () => buildConnectorItems({ builtinServers, userEntries, chatTools }),
    [builtinServers, chatTools, userEntries],
  )
  const filtered = React.useMemo(
    () => filterConnectorItems(items, query, chip),
    [chip, items, query],
  )
  const groups = React.useMemo(() => groupConnectorItems(filtered), [filtered])

  // 目录卡状态输入：安装 / 启用 / 真实握手验证三份集合均来自当前工作区 MCP 配置。
  const installedMcpNames = React.useMemo(() => new Set(userEntries.map(([name]) => name)), [userEntries])
  const enabledMcpNames = React.useMemo(
    () => new Set(userEntries.filter(([, entry]) => entry.enabled).map(([name]) => name)),
    [userEntries],
  )
  const verifiedMcpNames = React.useMemo(
    () => new Set(userEntries.filter(([, entry]) => entry.lastTestResult?.success === true).map(([name]) => name)),
    [userEntries],
  )
  const catalogQuery = query.trim()
  const catalogMcps = React.useMemo(
    () => MCP_INTEGRATION_CATALOG.filter((integration): integration is CatalogMcpIntegration =>
      isCatalogIntegrationVisible(integration) && integration.kind === 'mcp' && matchesCatalogSearch(integration, catalogQuery)),
    [catalogQuery],
  )
  const catalogClis = React.useMemo(
    () => MCP_INTEGRATION_CATALOG.filter((integration): integration is CatalogCliIntegration =>
      isCatalogIntegrationVisible(integration) && integration.kind === 'cli' && matchesCatalogSearch(integration, catalogQuery)),
    [catalogQuery],
  )
  const catalogGuided = React.useMemo(
    () => MCP_INTEGRATION_CATALOG.filter((integration): integration is CatalogGuidedIntegration =>
      isCatalogIntegrationVisible(integration) && integration.kind === 'guided' && matchesCatalogSearch(integration, catalogQuery)),
    [catalogQuery],
  )
  const catalogCredentials = React.useMemo(
    () => MCP_INTEGRATION_CATALOG.filter((integration): integration is CatalogCredentialIntegration =>
      isCatalogIntegrationVisible(integration) && integration.kind === 'credential' && matchesCatalogSearch(integration, catalogQuery)),
    [catalogQuery],
  )
  const catalogCardCount = catalogMcps.length + catalogClis.length + catalogGuided.length + catalogCredentials.length

  const openItem = React.useCallback((item: ConnectorItem): void => {
    setSelected(item)
  }, [])

  React.useEffect(() => {
    if (!openConnectorId) return
    const item = items.find((candidate) => candidate.id === openConnectorId)
    if (item) {
      openItem(item)
      onOpenConnectorConsumed?.()
      return
    }
    if (!toolsFetchDone) return
    console.error('[连接器] 未找到要打开的连接器:', openConnectorId)
    toast.error('未找到对应连接器')
    onOpenConnectorConsumed?.()
  }, [items, onOpenConnectorConsumed, openConnectorId, openItem, toolsFetchDone])

  React.useEffect(() => {
    if (!selected) return
    const next = items.find((item) => item.id === selected.id)
    if (!next) {
      setSelected(null)
      return
    }
    if (
      next.enabled !== selected.enabled
      || next.status !== selected.status
      || next.available !== selected.available
      || next.statusReason !== selected.statusReason
    ) {
      setSelected(next)
    }
  }, [items, selected])

  const toggle = React.useCallback(async (item: ConnectorItem, enabled: boolean): Promise<void> => {
    try {
      switch (item.kind) {
        case 'builtin-mcp':
          await onToggleBuiltin(item.sourceId, enabled)
          if (item.sourceId === 'nano-banana') {
            await window.electronAPI.updateChatToolState('nano-banana', { enabled })
            setChatTools(await window.electronAPI.getChatTools())
          }
          return
        case 'user-mcp':
          await onToggleMcp(item.sourceId, enabled)
          return
        case 'api-tool':
        case 'custom-http':
          await window.electronAPI.updateChatToolState(item.sourceId, { enabled })
          setChatTools(await window.electronAPI.getChatTools())
          return
        default: {
          const _exhaustive: never = item.kind
          return _exhaustive
        }
      }
    } catch (error) {
      console.error('[连接器] 切换状态失败:', error)
      toast.error('切换连接器状态失败')
    }
  }, [onToggleBuiltin, onToggleMcp, setChatTools])

  React.useEffect(() => {
    if (!pendingOpenMcpName) return
    const item = items.find((candidate) => candidate.id === `mcp:${pendingOpenMcpName}`)
    if (!item) return
    setPendingOpenMcpName(null)
    openItem(item)
  }, [items, openItem, pendingOpenMcpName])

  /** 目录 MCP 的连接动作：未配置走原子安装，已存在则直接重新握手验证；已连接改为打开本地详情。 */
  const handleCatalogMcpAction = React.useCallback(async (integration: CatalogMcpIntegration): Promise<void> => {
    const connected = installedMcpNames.has(integration.serverName)
      && enabledMcpNames.has(integration.serverName)
      && verifiedMcpNames.has(integration.serverName)
    if (connected) {
      const item = items.find((candidate) => candidate.id === `mcp:${integration.serverName}`)
      if (item) {
        openItem(item)
        return
      }
    }

    setInstallingCatalogId(integration.id)
    try {
      // OAuth 条目先写入非敏感模板，授权在「我的连接」详情里由 McpCredentialActions 完成；
      // 不能把「模板已写入」当成已连接，也不要在这里伪造授权状态。
      if (integration.authentication === 'oauth') {
        const existed = installedMcpNames.has(integration.serverName)
        if (!existed) {
          const installed = await window.electronAPI.installMcpAndValidate(workspaceSlug, integration.serverName, integration.entry)
          if (!installed.installed) {
            toast.info(`${integration.name} 已存在`, { description: '可直接在「我的连接」中打开并完成授权。' })
            return
          }
        }
        setPendingOpenMcpName(integration.serverName)
        toast.success(`${integration.name} ${existed ? '待授权' : '配置已写入'}`, {
          description: '在打开的详情里点击「OAuth 授权」完成授权。',
        })
        return
      }

      const result = installedMcpNames.has(integration.serverName)
        ? await window.electronAPI.setMcpEnabledAndValidate(workspaceSlug, integration.serverName, true)
        : await window.electronAPI.installMcpAndValidate(workspaceSlug, integration.serverName, integration.entry)
      if (result.verification.success) {
        toast.success(`${integration.name} 已连接`, { description: '已完成真实握手与工具发现验证。' })
        return
      }
      toast.warning(`${integration.name} 尚未连接`, { description: result.verification.message })
    } catch (error) {
      console.error(`[连接器] 安装 ${integration.name} 失败:`, error)
      toast.error(`${integration.name} 安装失败`, { description: error instanceof Error ? error.message : '请稍后重试' })
    } finally {
      setInstallingCatalogId(null)
      onUserMcpChanged?.()
    }
  }, [enabledMcpNames, installedMcpNames, items, onUserMcpChanged, openItem, verifiedMcpNames, workspaceSlug])

  /**
   * 目录「单凭据」条目：写入模板 → 凭据存 Keychain → 显式启用做真实握手与工具发现。
   * 只有验证成功才保持启用，避免无效配置被下一轮 Agent 注入。
   */
  const connectCatalogCredential = React.useCallback(async (
    integration: CatalogCredentialIntegration,
    value: string,
  ): Promise<void> => {
    setInstallingCatalogId(integration.id)
    try {
      if (!installedMcpNames.has(integration.serverName)) {
        const installed = await window.electronAPI.installMcpAndValidate(workspaceSlug, integration.serverName, integration.entry)
        if (!installed.installed) throw new Error('无法创建连接配置')
      }

      const rawValue = value.trim()
      const valuePrefix = integration.credential.valuePrefix ?? ''
      // 用户可能直接粘贴带前缀的完整请求头值（如 "Bearer abc"）：先剥离再统一拼接，
      // 避免写出 "Bearer Bearer ..." 导致 401 且错误凭据已进 Keychain。
      const bareValue = valuePrefix && rawValue.toLowerCase().startsWith(valuePrefix.trim().toLowerCase())
        ? rawValue.slice(valuePrefix.trim().length).trimStart()
        : rawValue

      await window.electronAPI.saveMcpApiKey({
        workspaceSlug,
        serverName: integration.serverName,
        serverUrl: integration.credential.credentialStorageUrl,
        headerName: integration.credential.headerName,
        ...(integration.credential.envName ? { envName: integration.credential.envName } : {}),
        ...(integration.entry.type === 'stdio' && integration.entry.command
          ? { stdioBinding: { command: integration.entry.command, args: integration.entry.args ?? [] } }
          : {}),
        value: `${valuePrefix}${bareValue}`,
      })

      const result = await window.electronAPI.setMcpEnabledAndValidate(workspaceSlug, integration.serverName, true)
      if (!result.verification.success) {
        throw new Error(result.verification.message || 'MCP 握手或工具发现失败，请检查 Token 与权限后重试')
      }
      toast.success(`${integration.name} 已连接`, {
        description: '凭据已加密保存到系统 Keychain，并已通过真实握手和工具发现验证。',
      })
    } catch (error) {
      console.error(`[连接器] ${integration.name} 凭据配置失败:`, error)
      toast.error(`${integration.name} 连接失败`, { description: error instanceof Error ? error.message : '请检查凭据后重试' })
      throw error
    } finally {
      setInstallingCatalogId(null)
      onUserMcpChanged?.()
    }
  }, [installedMcpNames, onUserMcpChanged, workspaceSlug])

  /** 引导类条目（含 CLI）：把 agentPrompt 交给一个新的 Agent 会话执行（复用本地 Skills 分类会话的做法）。 */
  const guideWithAgentPrompt = React.useCallback(async (name: string, prompt: string): Promise<void> => {
    try {
      const sessionId = await createAgent()
      if (!sessionId) {
        toast.error('创建 Agent 会话失败')
        return
      }
      setPendingPrompt({ sessionId, message: prompt })
      toast.success(`已创建 ${name} 配置会话`, { description: 'Agent 会按官方文档引导你完成配置。' })
    } catch (error) {
      console.error(`[连接器] 创建 ${name} 配置会话失败:`, error)
      toast.error(error instanceof Error ? error.message : `创建 ${name} 配置会话失败`)
    }
  }, [createAgent, setPendingPrompt])

  const hasReviewHints = !!reviewHints && (
    reviewHints.leftoverWorkspaceMcp.length > 0 || reviewHints.mcpSuffixedServers.length > 0
  )

  let body: React.ReactNode
  if (items.length === 0) {
    body = <EmptyConnectors onAddMcp={onAddMcp} onAddHttp={onAddHttp} />
  } else if (filtered.length === 0) {
    body = <EmptySearch />
  } else if (chip === 'all' && !query.trim()) {
    body = (
      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <section key={group.categoryLabel} className="flex flex-col gap-3">
            <div className="text-sm font-semibold text-foreground">{group.categoryLabel}</div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.items.map((item) => (
                <ConnectorCard
                  key={item.id}
                  item={item}
                  onOpen={() => openItem(item)}
                  onToggle={(enabled) => void toggle(item, enabled)}
                  onRequestDelete={
                    item.kind === 'user-mcp' && onRequestDeleteMcp
                      ? () => onRequestDeleteMcp(item.sourceId)
                      : item.kind === 'custom-http' && onRequestDeleteHttp
                        ? () => onRequestDeleteHttp({ id: item.sourceId, name: item.name })
                        : undefined
                  }
                />
              ))}
            </div>
          </section>
        ))}
        <p className="text-[12px] leading-relaxed text-foreground/45">
          当前内置 Chrome 浏览器、联网搜索、AI 生图；第三方服务可在下方「集成目录」中连接，也可手动添加本地/远程服务或自定义 HTTP。
        </p>
      </div>
    )
  } else {
    body = (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((item) => (
          <ConnectorCard
            key={item.id}
            item={item}
            onOpen={() => openItem(item)}
            onToggle={(enabled) => void toggle(item, enabled)}
            onRequestDelete={
              item.kind === 'user-mcp' && onRequestDeleteMcp
                ? () => onRequestDeleteMcp(item.sourceId)
                : item.kind === 'custom-http' && onRequestDeleteHttp
                  ? () => onRequestDeleteHttp({ id: item.sourceId, name: item.name })
                  : undefined
            }
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <ScopeBanner />
      {hasReviewHints && reviewHints && (
        <HintsBanner hints={reviewHints} onDismiss={onDismissHints} />
      )}

      {chip === 'all' && !query.trim() && (
        <NeedsConfigGuide items={items} onOpen={openItem} />
      )}

      {items.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-thin">
          {CONNECTOR_FILTER_CHIPS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setChip(entry.key)}
              className={cn(
                'shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition-[background-color,color] duration-fast ease-out',
                chip === entry.key
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-foreground/10 hover:text-foreground',
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}

      {body}

      {chip === 'all' && catalogCardCount > 0 && (
        <IntegrationCatalog
          mcps={catalogMcps}
          clis={catalogClis}
          guided={catalogGuided}
          credentials={catalogCredentials}
          embedded={false}
          installedMcpNames={installedMcpNames}
          enabledMcpNames={enabledMcpNames}
          verifiedMcpNames={verifiedMcpNames}
          activeSkillSlugs={activeSkillSlugs ?? EMPTY_SKILL_SLUGS}
          installingMcpId={installingCatalogId}
          onInstallMcp={(integration) => { void handleCatalogMcpAction(integration) }}
          onGuideCli={(integration) => { void guideWithAgentPrompt(integration.name, integration.agentPrompt) }}
          onGuide={(integration) => { void guideWithAgentPrompt(integration.name, integration.agentPrompt) }}
          onRequestCredential={setCredentialRequest}
          onToggleMcp={onToggleMcp}
        />
      )}

      <CredentialDialog
        integration={credentialRequest}
        onOpenChange={(open) => { if (!open) setCredentialRequest(null) }}
        onSave={connectCatalogCredential}
      />

      <ConnectorDetailDialog
        open={!!selected}
        item={selected}
        onOpenChange={(open) => { if (!open) setSelected(null) }}
        builtinServers={builtinServers}
        userEntries={userEntries}
        workspaceSlug={workspaceSlug}
        onToggle={(item, enabled) => void toggle(item, enabled)}
        onUserMcpChanged={onUserMcpChanged}
        onDeletedHttp={() => setSelected(null)}
      />
    </div>
  )
}

function ScopeBanner(): React.ReactElement {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-content-area px-3 py-2 text-[13px] text-foreground/60">
      <Globe size={14} className="shrink-0 text-foreground/45" />
      <span>连接器配置按工作区保存，仅当前工作区生效；切换工作区会看到各自的连接器列表</span>
    </div>
  )
}

function HintsBanner({
  hints,
  onDismiss,
}: {
  hints: GlobalScopeReviewHints
  onDismiss: () => void
}): React.ReactElement {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[13px] leading-5 text-amber-700 dark:text-amber-400">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <div className="flex-1 space-y-1">
        <div>升级时已将各工作区的连接器合并进全局配置，发现以下需要你确认：</div>
        {hints.mcpSuffixedServers.length > 0 && (
          <div className="text-amber-600/80 dark:text-amber-400/70">
            同名冲突已加后缀保留：{hints.mcpSuffixedServers.join('、')}（可在下方列表里重命名或删除冗余项）
          </div>
        )}
        {hints.leftoverWorkspaceMcp.length > 0 && (
          <div className="text-amber-600/80 dark:text-amber-400/70">
            以下工作区迁移尚未完成：{hints.leftoverWorkspaceMcp.join('、')}（重启 Guru 会自动重试）
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded p-1 text-amber-600/60 transition-[background-color,color] duration-fast ease-out hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400/60"
      >
        <X size={14} />
      </button>
    </div>
  )
}

function NeedsConfigGuide({
  items,
  onOpen,
}: {
  items: ConnectorItem[]
  onOpen: (item: ConnectorItem) => void
}): React.ReactElement | null {
  const pending = items.filter((item) => isConnectorAttentionStatus(item.status))
  if (pending.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {pending.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onOpen(item)}
          className="group flex items-center justify-between gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.08] px-4 py-3 text-left transition-[border-color,background-color,transform] duration-fast ease-out hover:border-amber-500/40 active:scale-[var(--press-scale)]"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">{item.name}</span>
            <span className="block truncate text-[12px] text-foreground/55">
              {item.statusReason ?? '需要配置后才能给 Agent 使用'}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-amber-700 dark:text-amber-400">
            {item.nextActionLabel ?? '去配置'}
            <ArrowRight size={14} className="transition-transform duration-fast ease-out group-hover:translate-x-0.5" />
          </span>
        </button>
      ))}
    </div>
  )
}

function EmptyConnectors({
  onAddMcp,
  onAddHttp,
}: {
  onAddMcp: () => void
  onAddHttp: () => void
}): React.ReactElement {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 pt-24 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.04]">
        <Plus className="size-8 text-foreground/30" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="text-[15px] font-medium text-foreground/85">暂无连接器</div>
        <p className="text-[13px] leading-relaxed text-foreground/50">
          添加自定义连接，或配置内置搜索 / 生图 / 浏览器能力。
        </p>
      </div>
      <AddConnectorMenu onAddMcp={onAddMcp} onAddHttp={onAddHttp} className="mt-2" />
    </div>
  )
}

function EmptySearch(): React.ReactElement {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 pt-24 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-foreground/[0.04]">
        <Search className="size-8 text-foreground/30" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="text-[15px] font-medium text-foreground/85">没有匹配的连接器</div>
        <p className="text-[13px] leading-relaxed text-foreground/50">试试更换分类或搜索关键词。</p>
      </div>
    </div>
  )
}
