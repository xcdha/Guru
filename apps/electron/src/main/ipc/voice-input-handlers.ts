/**
 * voice-input-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「语音输入」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { VOICE_DICTATION_IPC_CHANNELS } from '../../types'
import type { MicPermissionResult, VoiceDictationAudioChunkInput, VoiceDictationCommitInput, VoiceDictationCommitResult, VoiceDictationPreviewInput, VoiceDictationResizeInput, VoiceDictationSettings, VoiceDictationSettingsUpdate, VoiceDictationStartInput, VoiceDictationStopInput, VoiceDictationTestResult, VoiceDictationTextDeliveryInput, VoiceDictationToggleInput } from '../../types'
import { BrowserWindow, ipcMain } from 'electron'

export function registerVoiceInputHandlers(): void {
  // ===== 语音输入 =====

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.GET_SETTINGS,
    async (): Promise<VoiceDictationSettings> => {
      const { getVoiceDictationSettings } = await import('../lib/voice-dictation-settings-service')
      return getVoiceDictationSettings()
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.UPDATE_SETTINGS,
    async (_, updates: VoiceDictationSettingsUpdate): Promise<VoiceDictationSettings> => {
      const { updateVoiceDictationSettings } = await import('../lib/voice-dictation-settings-service')
      return updateVoiceDictationSettings(updates)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.TEST_CONNECTION,
    async (_, updates?: VoiceDictationSettingsUpdate): Promise<VoiceDictationTestResult> => {
      const { getVoiceDictationSettings } = await import('../lib/voice-dictation-settings-service')
      const { testDoubaoAsrConnection } = await import('../lib/doubao-asr-service')
      const settings = { ...getVoiceDictationSettings(), ...(updates ?? {}) }
      return testDoubaoAsrConnection(settings)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.TOGGLE,
    async (event, input?: VoiceDictationToggleInput): Promise<void> => {
      const { toggleVoiceDictationWindow } = await import('../lib/voice-dictation-window')
      const sourceWindow = BrowserWindow.fromWebContents(event.sender)
      const sourceInputId = typeof input?.sourceInputId === 'string' && input.sourceInputId.length > 0 && input.sourceInputId.length <= 512
        ? input.sourceInputId
        : undefined
      toggleVoiceDictationWindow({ targetIsGuru: !!sourceWindow, sourceInputId })
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.START,
    async (event, input: VoiceDictationStartInput): Promise<void> => {
      const { getVoiceDictationSettings } = await import('../lib/voice-dictation-settings-service')
      const { startDoubaoAsrSession } = await import('../lib/doubao-asr-service')
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('语音输入窗口不存在')
      await startDoubaoAsrSession(input.sessionId, getVoiceDictationSettings(), win)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.SEND_AUDIO,
    async (_, input: VoiceDictationAudioChunkInput): Promise<void> => {
      const { sendDoubaoAsrAudio } = await import('../lib/doubao-asr-service')
      sendDoubaoAsrAudio(input.sessionId, input.data)
    }
  )

  ipcMain.on(VOICE_DICTATION_IPC_CHANNELS.REPORT_VOLUME, (event, volume: unknown) => {
    void Promise.all([
      import('../index'),
      import('../lib/voice-dictation-window'),
    ]).then(([{ getMainWindow }, { updateVoiceDictationIndicatorVolume }]) => {
      const mainWindow = getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) return
      updateVoiceDictationIndicatorVolume(typeof volume === 'number' ? volume : 0)
    }).catch(console.error)
  })

  ipcMain.on(VOICE_DICTATION_IPC_CHANNELS.REPORT_TRANSCRIPT, (event, text: unknown) => {
    void Promise.all([
      import('../index'),
      import('../lib/voice-dictation-window'),
    ]).then(([{ getMainWindow }, { updateVoiceDictationIndicatorTranscript }]) => {
      const mainWindow = getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) return
      updateVoiceDictationIndicatorTranscript(typeof text === 'string' ? text.slice(-4_000) : '')
    }).catch(console.error)
  })

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.STOP,
    async (_, input: VoiceDictationStopInput): Promise<void> => {
      const { stopDoubaoAsrSession } = await import('../lib/doubao-asr-service')
      await stopDoubaoAsrSession(input.sessionId)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.CANCEL,
    async (_, input: VoiceDictationStopInput): Promise<void> => {
      const { cancelDoubaoAsrSession } = await import('../lib/doubao-asr-service')
      const { clearVoiceDictationPreview } = await import('../lib/text-output-service')
      clearVoiceDictationPreview(
        input.previewSessionId ?? input.sessionId,
        input.targetInputId,
        input.outputContextId,
      )
      cancelDoubaoAsrSession(input.sessionId)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.PREVIEW,
    async (_, input: VoiceDictationPreviewInput): Promise<void> => {
      const { getVoiceDictationSettings } = await import('../lib/voice-dictation-settings-service')
      const { previewVoiceDictationText } = await import('../lib/text-output-service')
      previewVoiceDictationText(input, getVoiceDictationSettings())
    }
  )

  ipcMain.on(VOICE_DICTATION_IPC_CHANNELS.ACK_INSERT_TEXT, (event, input: VoiceDictationTextDeliveryInput) => {
    void Promise.all([
      import('../index'),
      import('../lib/text-output-service'),
    ]).then(([{ getMainWindow }, { acknowledgeVoiceDictationTextDelivery }]) => {
      const mainWindow = getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) return
      if (!input || typeof input.sessionId !== 'string' || typeof input.delivered !== 'boolean') return
      acknowledgeVoiceDictationTextDelivery(input.sessionId, input.delivered)
    }).catch(console.error)
  })

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.COMMIT,
    async (_, input: VoiceDictationCommitInput): Promise<VoiceDictationCommitResult> => {
      const { getVoiceDictationSettings } = await import('../lib/voice-dictation-settings-service')
      const { commitVoiceDictationText } = await import('../lib/text-output-service')
      return commitVoiceDictationText(input, getVoiceDictationSettings())
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.HIDE,
    async (): Promise<void> => {
      const { hideVoiceDictationWindow } = await import('../lib/voice-dictation-window')
      hideVoiceDictationWindow()
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.RESIZE,
    async (_, input: VoiceDictationResizeInput): Promise<void> => {
      const { resizeVoiceDictationWindow } = await import('../lib/voice-dictation-window')
      resizeVoiceDictationWindow(input.height)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.CHECK_MIC_PERMISSION,
    async (): Promise<MicPermissionResult> => {
      const { checkMicrophonePermission } = await import('../lib/microphone-permission-service')
      return checkMicrophonePermission()
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.REQUEST_MIC_PERMISSION,
    async (): Promise<MicPermissionResult> => {
      const { requestMicrophonePermission } = await import('../lib/microphone-permission-service')
      return requestMicrophonePermission()
    }
  )
}
