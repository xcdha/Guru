/**
 * channel-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「渠道管理相关」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 * 同时迁入仅被该组使用的辅助声明: withOAuthDeviceCodeQr
 */

import { pokeAgentQueuedMessages } from '../lib/agent-service'
import { createChannel, decryptApiKey, deleteChannel, fetchModels, getChannelPlanQuota, listChannels, testChannel, testChannelDirect, updateChannel } from '../lib/channel-manager'
import { cancelClaudeOAuthLogin, exchangeClaudeOAuthCode, prepareClaudeOAuthLogin } from '../lib/claude-oauth-service'
import { cancelCodexOAuthLogin, loginCodexOAuth } from '../lib/codex-oauth-service'
import { cancelGithubCopilotOAuthLogin, loginGithubCopilotOAuth } from '../lib/github-copilot-oauth-service'
import { cancelXaiOAuthLogin, loginXaiOAuth } from '../lib/xai-oauth-service'
import { CHANNEL_IPC_CHANNELS, serializeClaudeOAuthCredentials, serializeCodexCredentials, serializeGithubCopilotCredentials, serializeXaiCredentials } from '@guru/shared'
import type { Channel, ChannelCreateInput, ChannelDirectTestInput, ChannelTestResult, ChannelUpdateInput, CodexOAuthDeviceCode, CodexOAuthLoginMethod, FetchModelsInput, FetchModelsResult, GithubCopilotOAuthDeviceCode, XaiOAuthDeviceCode } from '@guru/shared'
import { ipcMain } from 'electron'

async function withOAuthDeviceCodeQr<T extends CodexOAuthDeviceCode | GithubCopilotOAuthDeviceCode | XaiOAuthDeviceCode>(deviceCode: T): Promise<T> {
  try {
    const QRCode = (await import('qrcode')).default
    return { ...deviceCode, qrCodeData: await QRCode.toDataURL(deviceCode.verificationUri, { width: 240, margin: 1 }) }
  } catch (error) {
    console.warn('[OAuth] 生成设备码二维码失败:', error)
    return deviceCode
  }
}

export function registerChannelHandlers(): void {
  // ===== 渠道管理相关 =====

  // 获取所有渠道（apiKey 保持加密态）
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.LIST,
    async (): Promise<Channel[]> => {
      return listChannels()
    }
  )

  // 创建渠道
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.CREATE,
    async (_, input: ChannelCreateInput): Promise<Channel> => {
      const channel = createChannel(input)
      pokeAgentQueuedMessages()
      return channel
    }
  )

  // 更新渠道
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.UPDATE,
    async (_, id: string, input: ChannelUpdateInput): Promise<Channel> => {
      const channel = updateChannel(id, input)
      pokeAgentQueuedMessages()
      return channel
    }
  )

  // 删除渠道
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.DELETE,
    async (_, id: string): Promise<void> => {
      deleteChannel(id)
      pokeAgentQueuedMessages()
    }
  )

  // 解密 API Key（仅在用户查看时调用）
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.DECRYPT_KEY,
    async (_, channelId: string): Promise<string> => {
      return decryptApiKey(channelId)
    }
  )

  // 测试渠道连接
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.TEST,
    async (_, channelId: string): Promise<ChannelTestResult> => {
      return testChannel(channelId)
    }
  )

  // 直接测试连接（无需已保存渠道，传入明文凭证）
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.TEST_DIRECT,
    async (_, input: ChannelDirectTestInput): Promise<ChannelTestResult> => {
      return testChannelDirect(input)
    }
  )

  // 从供应商拉取可用模型列表（直接传入凭证，无需已保存渠道）
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.FETCH_MODELS,
    async (_, input: FetchModelsInput): Promise<FetchModelsResult> => {
      return fetchModels(input)
    }
  )

  // 查询订阅 Plan 额度（用于 Agent Context 圆环 hover 信息）
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.GET_PLAN_QUOTA,
    async (_, channelId: string): Promise<import('@guru/shared').ChannelPlanQuotaResult> => {
      return getChannelPlanQuota(channelId)
    }
  )

  // 发起 ChatGPT (Codex) OAuth 登录。登录在主进程执行（Pi SDK 用 Node crypto +
  // 本地 :1455 回调服务）；成功后返回序列化的凭据 JSON（明文），由渲染层作为
  // apiKey 传给 create/update，channel-manager 加密后存储——与现有 apiKey 明文回传模式一致。
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.CODEX_OAUTH_LOGIN,
    async (event, requestedMethod?: CodexOAuthLoginMethod): Promise<import('@guru/shared').CodexOAuthLoginResult> => {
      const method: CodexOAuthLoginMethod = requestedMethod === 'device_code' ? 'device_code' : 'browser'
      try {
        const credentials = await loginCodexOAuth({
          method,
          onDeviceCode: (deviceCode) => {
            void withOAuthDeviceCodeQr(deviceCode).then((payload) => {
              if (!event.sender.isDestroyed()) {
                event.sender.send(CHANNEL_IPC_CHANNELS.CODEX_OAUTH_DEVICE_CODE, payload)
              }
            }).catch((error) => console.warn('[OAuth] 发送 Codex device code 失败:', error))
          },
        })
        return {
          success: true,
          credentials: serializeCodexCredentials(credentials),
          ...(credentials.accountId ? { accountId: credentials.accountId } : {}),
        }
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        }
      }
    }
  )

  // 取消进行中的 ChatGPT OAuth 登录流程
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.CODEX_OAUTH_CANCEL,
    async (): Promise<void> => {
      cancelCodexOAuthLogin()
    }
  )

  // 发起 GitHub Copilot OAuth device-code 登录。Pi 在完成授权后会同步当前订阅和
  // 组织策略可用的模型；成功后的凭据沿用 Channel.apiKey 加密存储。
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.GITHUB_COPILOT_OAUTH_LOGIN,
    async (event, enterpriseUrl?: string): Promise<import('@guru/shared').GithubCopilotOAuthLoginResult> => {
      try {
        const credentials = await loginGithubCopilotOAuth({
          enterpriseUrl,
          onDeviceCode: (deviceCode) => {
            void withOAuthDeviceCodeQr(deviceCode).then((payload) => {
              if (!event.sender.isDestroyed()) {
                event.sender.send(CHANNEL_IPC_CHANNELS.GITHUB_COPILOT_OAUTH_DEVICE_CODE, payload)
              }
            }).catch((error) => console.warn('[OAuth] 发送 GitHub Copilot device code 失败:', error))
          },
        })
        return { success: true, credentials: serializeGithubCopilotCredentials(credentials) }
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.GITHUB_COPILOT_OAUTH_CANCEL,
    async (): Promise<void> => {
      cancelGithubCopilotOAuthLogin()
    }
  )

  // 生成 Claude Pro/Max 订阅登录授权 URL 并打开浏览器（主进程原生 PKCE 流程，
  // 不再 spawn claude 二进制——该二进制的 setup-token 是纯交互式 TUI，正式打包
  // 环境下没有 controlling terminal 会静默挂起，详见 claude-oauth-service.ts）。
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.CLAUDE_OAUTH_PREPARE,
    async (): Promise<import('@guru/shared').ClaudeOAuthPrepareResult> => {
      try {
        const authUrl = prepareClaudeOAuthLogin()
        return { success: true, authUrl }
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        }
      }
    }
  )

  // 用用户从浏览器回调页粘贴的授权码换取凭据；成功后返回序列化的凭据 JSON（明文），
  // 由渲染层作为 apiKey 传给 create/update，channel-manager 加密后存储——与 Codex
  // OAuth、以及现有 apiKey 明文回传模式一致。
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.CLAUDE_OAUTH_EXCHANGE,
    async (_event, code: string): Promise<import('@guru/shared').ClaudeOAuthLoginResult> => {
      try {
        const credentials = await exchangeClaudeOAuthCode(code)
        return {
          success: true,
          credentials: serializeClaudeOAuthCredentials(credentials),
        }
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        }
      }
    }
  )

  // 取消进行中的 Claude 订阅 OAuth 登录流程
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.CLAUDE_OAUTH_CANCEL,
    async (): Promise<void> => {
      cancelClaudeOAuthLogin()
    }
  )

  // 发起 xAI（Grok/X 订阅）OAuth device-code 登录。Pi 会通过 device-code 事件给出
  // 预填的浏览器授权链接；成功后的凭据沿用 Channel.apiKey 加密存储。
  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.XAI_OAUTH_LOGIN,
    async (event): Promise<import('@guru/shared').XaiOAuthLoginResult> => {
      try {
        const credentials = await loginXaiOAuth({
          onDeviceCode: (deviceCode) => {
            void withOAuthDeviceCodeQr(deviceCode).then((payload) => {
              if (!event.sender.isDestroyed()) {
                event.sender.send(CHANNEL_IPC_CHANNELS.XAI_OAUTH_DEVICE_CODE, payload)
              }
            }).catch((error) => console.warn('[OAuth] 发送 xAI device code 失败:', error))
          },
        })
        return { success: true, credentials: serializeXaiCredentials(credentials) }
      } catch (error) {
        return { success: false, message: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcMain.handle(
    CHANNEL_IPC_CHANNELS.XAI_OAUTH_CANCEL,
    async (): Promise<void> => {
      cancelXaiOAuthLogin()
    }
  )
}
