/**
 * feedback-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「用户反馈」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { FEEDBACK_IPC_CHANNELS } from '@guru/shared'
import type { FeedbackGithubConfig, FeedbackSubmitInput } from '@guru/shared'
import { ipcMain } from 'electron'

export function registerFeedbackHandlers(): void {
  // ===== 用户反馈（→ GitHub Issues）=====

  // 提交反馈到 GitHub Issues（含截图 user-attachments 上传，失败自动落本地草稿）
  ipcMain.handle(
    FEEDBACK_IPC_CHANNELS.SUBMIT,
    async (_event, input: FeedbackSubmitInput, appVersion?: string, platform?: string) => {
      const { submitFeedback } = await import('../lib/feedback-service')
      return submitFeedback(input, appVersion ?? '', platform ?? '')
    }
  )

  // 测试 GitHub 凭证（PAT 是否有效且有目标仓库权限）
  ipcMain.handle(
    FEEDBACK_IPC_CHANNELS.TEST_CONNECTION,
    async (_event, config: FeedbackGithubConfig) => {
      const { testFeedbackConnection } = await import('../lib/feedback-service')
      return testFeedbackConnection(config)
    }
  )

  // 读取反馈渠道配置（不返回 token 明文）
  ipcMain.handle(
    FEEDBACK_IPC_CHANNELS.GET_CONFIG,
    async () => {
      const { getFeedbackConfigPublic } = await import('../lib/feedback-service')
      return getFeedbackConfigPublic()
    }
  )

  // 保存反馈渠道配置
  ipcMain.handle(
    FEEDBACK_IPC_CHANNELS.SAVE_CONFIG,
    async (_event, config: FeedbackGithubConfig) => {
      const { saveFeedbackConfig } = await import('../lib/feedback-service')
      saveFeedbackConfig(config)
    }
  )

  // 截取当前应用窗口（renderer 会在调用前短暂隐藏反馈弹窗自身）
  ipcMain.handle(
    FEEDBACK_IPC_CHANNELS.CAPTURE_WINDOW,
    async (event) => {
      const { captureFeedbackWindow } = await import('../lib/feedback-service')
      return captureFeedbackWindow(event.sender)
    }
  )

  // 选择本地图片（压缩后返回预览 dataUrl + 提交用 filePath）
  ipcMain.handle(
    FEEDBACK_IPC_CHANNELS.PICK_IMAGES,
    async (event) => {
      const { pickFeedbackImages } = await import('../lib/feedback-service')
      return pickFeedbackImages(event.sender)
    }
  )

  // 列出本地反馈草稿（v2 可重试，v1 旧格式标记 legacy）
  ipcMain.handle(FEEDBACK_IPC_CHANNELS.LIST_DRAFTS, async () => {
    const { listFeedbackDrafts } = await import('../lib/feedback-service')
    return listFeedbackDrafts()
  })

  // 删除本地反馈草稿（按文件名）
  ipcMain.handle(FEEDBACK_IPC_CHANNELS.DELETE_DRAFT, async (_event, fileName: string) => {
    const { deleteFeedbackDraft } = await import('../lib/feedback-service')
    return deleteFeedbackDraft(fileName)
  })
}
