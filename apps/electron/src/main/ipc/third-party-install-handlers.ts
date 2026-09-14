/**
 * third-party-install-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「第三方安装包」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { cancelInstallerDownload, downloadInstaller, launchInstaller } from '../lib/installer-downloader'
import { fetchInstallerManifest, findInstallerSource } from '../lib/installer-manifest'
import { INSTALLER_IPC_CHANNELS } from '@guru/shared'
import type { InstallerDownloadRequest, InstallerDownloadResult, InstallerManifest } from '@guru/shared'
import { BrowserWindow, ipcMain } from 'electron'

export function registerThirdPartyInstallHandlers(): void {
  // ===== 第三方安装包（Git / Node.js）相关 =====

  ipcMain.handle(
    INSTALLER_IPC_CHANNELS.MANIFEST,
    async (): Promise<InstallerManifest> => {
      return fetchInstallerManifest()
    }
  )

  ipcMain.handle(
    INSTALLER_IPC_CHANNELS.DOWNLOAD,
    async (event, req: InstallerDownloadRequest): Promise<InstallerDownloadResult> => {
      const manifest = await fetchInstallerManifest()
      const source = findInstallerSource(manifest, req.id, req.arch)
      if (!source) {
        throw new Error(`未找到安装包：id=${req.id}, arch=${req.arch}`)
      }
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) {
        throw new Error('发起下载的窗口已关闭')
      }
      const key = `${req.id}:${req.arch}`
      return downloadInstaller(source, key, window)
    }
  )

  ipcMain.handle(
    INSTALLER_IPC_CHANNELS.CANCEL,
    async (_event, key: string): Promise<boolean> => {
      return cancelInstallerDownload(key)
    }
  )

  ipcMain.handle(
    INSTALLER_IPC_CHANNELS.LAUNCH,
    async (_event, filePath: string): Promise<void> => {
      await launchInstaller(filePath)
    }
  )
}
