/**
 * McpCredentialActions — user-mcp 连接器详情内的「凭据与授权」动作区
 *
 * 把上游 Proma 的 MCP OAuth / 静态凭据能力映射进本地 Connector 体系：
 * - OAuth：entry.oauth 存在时提供「OAuth 授权」按钮，走主进程 PKCE 授权码流程；
 *   clientSecretRequired 且本会话尚未保存过 secret 时，先经 OAuthClientSecretDialog
 *   安全写入 Keychain，再继续浏览器授权。
 * - 静态密钥：无 OAuth 配置时提供「保存密钥」入口（saveMcpApiKey，运行时按请求头/环境变量注入）；
 *   两类场景都可用「删除凭据」清除该连接器对应的 Keychain 载荷。
 * 所有密钥值只经 IPC 进入 safeStorage/Keychain：不回显、不写入 mcp.json、不暴露给 Agent。
 */

import * as React from 'react'
import { KeyRound, Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { McpServerEntry } from '@guru/shared'
import { OAuthClientSecretDialog } from './OAuthClientSecretDialog'

/**
 * 本会话内已成功保存过 OAuth client secret 的服务（key: workspaceSlug:serverName）。
 * 授权失败且主进程明确要求 Client Secret 时会清理对应项，允许用户重新输入。
 */
const savedClientSecrets = new Set<string>()

interface McpCredentialActionsProps {
  serverName: string
  entry: McpServerEntry
  workspaceSlug: string
  /** 数据变更后的刷新回调（授权成功后启用状态与验证结果会变化） */
  onChanged?: () => void
}

export function McpCredentialActions({
  serverName,
  entry,
  workspaceSlug,
  onChanged,
}: McpCredentialActionsProps): React.ReactElement {
  const isRemote = entry.type === 'http' || entry.type === 'sse'
  const hasOauth = Boolean(entry.oauth)
  const remoteReady = isRemote && Boolean(entry.url?.trim())
  const stdioReady = entry.type === 'stdio' && Boolean(entry.command?.trim())
  const credentialReady = remoteReady || stdioReady
  const secretKey = `${workspaceSlug}:${serverName}`

  const [authorizing, setAuthorizing] = React.useState(false)
  const [authorizedThisSession, setAuthorizedThisSession] = React.useState(false)
  const [secretPromptOpen, setSecretPromptOpen] = React.useState(false)
  const [keyDialogOpen, setKeyDialogOpen] = React.useState(false)
  const [feedback, setFeedback] = React.useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null)

  // 切换连接器时重置会话内展示状态（savedClientSecrets 是跨连接器共享的模块级缓存）
  React.useEffect(() => {
    setFeedback(null)
    setAuthorizedThisSession(false)
    setSecretPromptOpen(false)
    setKeyDialogOpen(false)
  }, [serverName])

  const runOAuthAuthorize = React.useCallback(async (): Promise<void> => {
    const oauth = entry.oauth
    if (!oauth || !entry.url) return
    setAuthorizing(true)
    setFeedback(null)
    try {
      await window.electronAPI.startMcpOAuth({
        workspaceSlug,
        serverName,
        provider: oauth.provider ?? serverName,
        serverUrl: entry.url,
        oauth,
      })
      // 授权完成后立即做一次真实握手验证（对齐上游 authorizeMcp 的 toggle+verify）。
      const result = await window.electronAPI.setMcpEnabledAndValidate(workspaceSlug, serverName, true)
      onChanged?.()
      if (!result.verification.success) {
        setFeedback({ tone: 'warning', text: `授权已完成，但连接验证未通过：${result.verification.message}` })
        toast.warning(`${serverName} 已授权，但连接验证未通过`, { description: result.verification.message })
        return
      }
      setAuthorizedThisSession(true)
      setFeedback({ tone: 'success', text: '已授权，连接验证通过。token 已加密保存在系统 Keychain。' })
      toast.success(`${serverName} 已完成授权`, { description: 'OAuth token 已安全保存，并已通过真实连接验证。' })
    } catch (error) {
      const message = error instanceof Error ? error.message : '请检查 OAuth 配置后重试'
      console.error(`[连接器] ${serverName} OAuth 失败:`, error)
      if (/client\s*secret/i.test(message)) {
        // 主进程要求 Client Secret 但本会话未保存（或已被清除）：重新打开安全输入入口。
        savedClientSecrets.delete(secretKey)
        setSecretPromptOpen(true)
      }
      setFeedback({ tone: 'error', text: `授权失败：${message}` })
      toast.error(`${serverName} 授权失败`, { description: message })
    } finally {
      setAuthorizing(false)
    }
  }, [entry.oauth, entry.url, onChanged, secretKey, serverName, workspaceSlug])

  const handleAuthorizeClick = (): void => {
    const oauth = entry.oauth
    if (!oauth) return
    if (!remoteReady) {
      setFeedback({ tone: 'error', text: '当前连接器缺少可授权的远程地址（url）。' })
      toast.error('当前连接器缺少可授权的远程地址')
      return
    }
    if (!oauth.clientId && !oauth.registrationEndpoint) {
      setFeedback({ tone: 'warning', text: 'OAuth 参数待补全：需要公开 clientId 或 registrationEndpoint。' })
      toast.error('OAuth 参数待补全', {
        description: '请让 Agent 依据官方文档补全公开 clientId 或 registrationEndpoint；token 与 client secret 不会写入配置。',
      })
      return
    }
    if (oauth.clientSecretRequired && !savedClientSecrets.has(secretKey)) {
      setSecretPromptOpen(true)
      return
    }
    void runOAuthAuthorize()
  }

  const handleSaveClientSecret = async (clientSecret: string): Promise<void> => {
    if (!entry.url) throw new Error('当前连接器缺少可授权的远程地址')
    try {
      await window.electronAPI.saveMcpOAuthClientSecret({
        workspaceSlug,
        serverName,
        serverUrl: entry.url,
        clientSecret,
      })
    } catch (error) {
      toast.error('保存 Client Secret 失败', { description: error instanceof Error ? error.message : '请稍后重试' })
      throw error
    }
    savedClientSecrets.add(secretKey)
    // 先让安全输入弹窗收尾，再从详情动作区继续用户显式的浏览器授权（对齐上游 queueMicrotask）。
    queueMicrotask(() => { void runOAuthAuthorize() })
  }

  const handleDeleteCredential = async (): Promise<void> => {
    try {
      await window.electronAPI.deleteMcpCredential(workspaceSlug, serverName)
      savedClientSecrets.delete(secretKey)
      setAuthorizedThisSession(false)
      setFeedback(null)
      toast.success(`已删除 ${serverName} 的系统凭据`)
    } catch (error) {
      console.error(`[连接器] 删除 ${serverName} 凭据失败:`, error)
      toast.error('删除凭据失败', { description: error instanceof Error ? error.message : '请稍后重试' })
    }
  }

  const handleSaveApiKey = async (keyName: string, value: string): Promise<void> => {
    try {
      if (entry.type === 'stdio') {
        await window.electronAPI.saveMcpApiKey({
          workspaceSlug,
          serverName,
          serverUrl: stdioCredentialUrl(serverName),
          headerName: '',
          envName: keyName,
          stdioBinding: { command: entry.command ?? '', args: entry.args ?? [] },
          value,
        })
      } else {
        if (!entry.url) throw new Error('当前连接器缺少 url')
        await window.electronAPI.saveMcpApiKey({
          workspaceSlug,
          serverName,
          serverUrl: entry.url,
          headerName: keyName,
          value,
        })
      }
    } catch (error) {
      toast.error('保存密钥失败', { description: error instanceof Error ? error.message : '请稍后重试' })
      throw error
    }
    toast.success('密钥已加密保存', {
      description: entry.type === 'stdio'
        ? `启动时将以 ${keyName} 环境变量注入；不会写入 mcp.json。`
        : `运行时将以 ${keyName} 请求头注入；不会写入 mcp.json。`,
    })
  }

  const defaultKeyName = inferCredentialKeyName(entry)

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/60 px-3 py-3">
      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium text-foreground">凭据与授权</div>
        <div className="text-[12px] leading-5 text-muted-foreground">
          {hasOauth
            ? 'OAuth token 与 Client Secret 只会加密保存到系统 Keychain，不会写入 mcp.json 或暴露给 Agent。'
            : '密钥只会加密保存到系统 Keychain，运行时按配置注入；不会写入 mcp.json 或暴露给 Agent。'}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {hasOauth ? (
          <Button size="sm" disabled={authorizing || !credentialReady} onClick={handleAuthorizeClick}>
            {authorizing ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {authorizing ? '等待浏览器授权…' : 'OAuth 授权'}
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={!credentialReady} onClick={() => setKeyDialogOpen(true)}>
            <KeyRound size={14} />
            保存密钥
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          disabled={authorizing}
          onClick={() => void handleDeleteCredential()}
        >
          <Trash2 size={14} />
          删除凭据
        </Button>
        {authorizedThisSession && !authorizing && (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
            <ShieldCheck size={12} />
            已授权
          </span>
        )}
      </div>

      {feedback && (
        <div
          className={cn(
            'rounded-lg px-3 py-2 text-[13px] leading-5',
            feedback.tone === 'success' && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
            feedback.tone === 'warning' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
            feedback.tone === 'error' && 'bg-destructive/10 text-destructive',
          )}
        >
          {feedback.text}
        </div>
      )}

      <OAuthClientSecretDialog
        serverName={secretPromptOpen ? serverName : null}
        onOpenChange={(open) => { if (!open) setSecretPromptOpen(false) }}
        onSave={handleSaveClientSecret}
      />

      <SaveCredentialDialog
        open={keyDialogOpen}
        onOpenChange={setKeyDialogOpen}
        serverName={serverName}
        keyNameLabel={isRemote ? '请求头名' : '环境变量名'}
        keyNamePlaceholder={isRemote ? '例如 Authorization、x-api-key' : '例如 BRAVE_API_KEY、GITHUB_TOKEN'}
        defaultKeyName={defaultKeyName}
        onSave={handleSaveApiKey}
      />
    </div>
  )
}

/** stdio MCP 没有网络地址；用稳定 URI 作为凭据存储命名空间（读取端不参与请求头注入比对）。 */
function stdioCredentialUrl(serverName: string): string {
  return `stdio://${encodeURIComponent(serverName)}`
}

/** 从既有 headers / env 推断凭据注入位置；推断不到时给常见默认值。 */
function inferCredentialKeyName(entry: McpServerEntry): string {
  if (entry.type === 'stdio') {
    const keys = Object.keys(entry.env ?? {})
    return keys[0] ?? ''
  }
  const keys = Object.keys(entry.headers ?? {})
  if (keys.length === 0) return 'Authorization'
  const preferred = keys.find((key) => /^authorization$/i.test(key) || /api[-_]?key|token/i.test(key))
  return preferred ?? keys[0] ?? 'Authorization'
}

interface SaveCredentialDialogProps {
  open: boolean
  serverName: string
  keyNameLabel: string
  keyNamePlaceholder: string
  defaultKeyName: string
  onOpenChange: (open: boolean) => void
  onSave: (keyName: string, value: string) => Promise<void>
}

/** 最小密钥输入弹窗：值只经 onSave（IPC）进入 Keychain，不回显、不落盘。 */
function SaveCredentialDialog({
  open,
  serverName,
  keyNameLabel,
  keyNamePlaceholder,
  defaultKeyName,
  onOpenChange,
  onSave,
}: SaveCredentialDialogProps): React.ReactElement {
  const nameRef = React.useRef<HTMLInputElement>(null)
  const valueRef = React.useRef<HTMLInputElement>(null)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    if (nameRef.current) nameRef.current.value = defaultKeyName
    if (valueRef.current) valueRef.current.value = ''
    setSaving(false)
  }, [open, defaultKeyName])

  const handleSave = async (): Promise<void> => {
    const keyName = nameRef.current?.value.trim() ?? ''
    const value = valueRef.current?.value ?? ''
    if (!keyName || !value.trim() || saving) return
    setSaving(true)
    try {
      await onSave(keyName, value)
      onOpenChange(false)
    } catch {
      // 保存失败：保持弹窗打开，错误反馈由 onSave 实现负责（toast）。
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] p-7" onOpenAutoFocus={(event) => event.preventDefault()}>
        {open && (
          <>
            <DialogHeader className="space-y-2 text-left">
              <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
                <KeyRound size={19} />保存连接密钥
              </DialogTitle>
              <DialogDescription className="text-[15px] leading-6">
                {serverName} 的密钥只会加密保存到系统 Keychain，运行时按配置注入；不会写入 mcp.json、显示给 Agent 或回传到页面。
              </DialogDescription>
            </DialogHeader>
            <div className="mt-7 flex flex-col gap-5">
              <div>
                <label className="text-sm font-medium text-foreground">
                  {keyNameLabel} <span className="text-destructive">*</span>
                </label>
                <Input
                  className="mt-2 h-10 font-mono text-sm"
                  placeholder={keyNamePlaceholder}
                  autoComplete="off"
                  ref={nameRef}
                  onKeyDown={(event) => { if (event.key === 'Enter') void handleSave() }}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">
                  密钥 <span className="text-destructive">*</span>
                </label>
                <Input
                  type="password"
                  className="mt-2 h-10 text-sm"
                  placeholder="粘贴 API Key / Token"
                  autoComplete="off"
                  ref={valueRef}
                  onKeyDown={(event) => { if (event.key === 'Enter') void handleSave() }}
                />
              </div>
            </div>
            <DialogFooter className="mt-7 gap-3 sm:justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button>
              <Button onClick={() => { void handleSave() }} disabled={saving}>
                {saving && <Loader2 size={15} className="animate-spin" />}
                加密保存
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
