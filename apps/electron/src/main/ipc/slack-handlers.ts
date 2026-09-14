/**
 * slack-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「Slack 集成」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { redactSensitiveLogValue } from '../lib/bridge-log-redaction'
import { slackBridgeManager } from '../lib/slack-bridge-manager'
import { getSlackSettingsConfig, removeSlackBot, saveSlackBotConfig, toSlackBotSettingsConfig } from '../lib/slack-config'
import { buildSlackManifest } from '../lib/slack/manifest'
import { SLACK_IPC_CHANNELS } from '@guru/shared'
import { ipcMain } from 'electron'

export function registerSlackHandlers(): void {
  // ===== Slack 集成 =====

  ipcMain.handle(
    SLACK_IPC_CHANNELS.GET_CONFIG,
    async (): Promise<import('@guru/shared').SlackSettingsConfig> => {
      return getSlackSettingsConfig()
    },
  )

  ipcMain.handle(
    SLACK_IPC_CHANNELS.SAVE_BOT_CONFIG,
    async (_event, input: import('@guru/shared').SlackBotConfigInput) => {
      const saved = saveSlackBotConfig(input)
      if (saved.enabled && saved.botToken && saved.appToken) {
        void slackBridgeManager.restartBot(saved.id).catch((error) => {
          console.error(`[Slack IPC] Bot "${saved.name}" 重启失败:`, redactSensitiveLogValue(error))
        })
      } else {
        void slackBridgeManager.stopBot(saved.id)
      }
      return toSlackBotSettingsConfig(saved)
    },
  )

  ipcMain.handle(
    SLACK_IPC_CHANNELS.REMOVE_BOT,
    async (_event, botId: string) => {
      await slackBridgeManager.stopBot(botId)
      return removeSlackBot(botId)
    },
  )

  ipcMain.handle(
    SLACK_IPC_CHANNELS.GET_MANIFEST,
    async (_event, options?: { botName?: string }) => {
      return buildSlackManifest(options)
    },
  )

  ipcMain.handle(
    SLACK_IPC_CHANNELS.TEST_CONNECTION,
    async (_event, botToken: string): Promise<import('@guru/shared').SlackTestResult> => {
      return slackBridgeManager.testConnection(botToken)
    },
  )

  ipcMain.handle(
    SLACK_IPC_CHANNELS.START_BOT,
    async (_event, botId: string): Promise<void> => {
      await slackBridgeManager.startBot(botId)
    },
  )

  ipcMain.handle(
    SLACK_IPC_CHANNELS.STOP_BOT,
    async (_event, botId: string): Promise<void> => {
      await slackBridgeManager.stopBot(botId)
    },
  )

  ipcMain.handle(
    SLACK_IPC_CHANNELS.GET_STATUS,
    async (): Promise<import('@guru/shared').SlackMultiBridgeState> => {
      return slackBridgeManager.getStates()
    },
  )
}
