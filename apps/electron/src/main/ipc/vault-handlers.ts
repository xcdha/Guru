/**
 * vault-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「用户授权的 Markdown Vault」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { getExpertsDir } from '../lib/config-paths'
import { createExpert, updateExpertFiles, updateExpertManifest } from '../lib/expert-service'
import { authorizeDiscoveredVault, clearVaultUserContext, configureVault, createUntitledVaultFile, createUntitledVaultFileInFolder, createVaultFolder, discoverVaultCandidates, getConfiguredVaultFileSystem, getVaultSummary, selectDefaultVault, setVaultUserContext } from '../lib/vault-service'
import { isNonEmptyString } from './validators'
import { EXPERT_IPC_CHANNELS, VAULT_IPC_CHANNELS } from '@guru/shared'
import type { ExpertManifest, ExpertPackage } from '@guru/shared/experts'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'

export function registerVaultHandlers(): void {
  // ===== 用户授权的 Markdown Vault =====

  ipcMain.handle(VAULT_IPC_CHANNELS.GET_CONFIG, async () => getVaultSummary())

  ipcMain.handle(VAULT_IPC_CHANNELS.SELECT_DEFAULT, async () => selectDefaultVault())

  ipcMain.handle(VAULT_IPC_CHANNELS.LIST_CANDIDATES, async () => discoverVaultCandidates())

  ipcMain.handle(VAULT_IPC_CHANNELS.SELECT, async (_, options: unknown) => {
    const input = options && typeof options === 'object' ? options as Record<string, unknown> : {}
    const inboxPath = typeof input.inboxPath === 'string' ? input.inboxPath : undefined
    const allowAgentWrites = input.allowAgentWrites === true
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: '选择 Vault 文件夹',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return configureVault(result.filePaths[0]!, { inboxPath, allowAgentWrites })
  })

  ipcMain.handle(VAULT_IPC_CHANNELS.AUTHORIZE_CANDIDATE, async (_, rootPath: unknown, options: unknown) => {
    if (typeof rootPath !== 'string') throw new Error('Vault 候选路径无效')
    const input = options && typeof options === 'object' ? options as Record<string, unknown> : {}
    return authorizeDiscoveredVault(rootPath, {
      inboxPath: typeof input.inboxPath === 'string' ? input.inboxPath : undefined,
      allowAgentWrites: input.allowAgentWrites === true,
    })
  })

  ipcMain.handle(VAULT_IPC_CHANNELS.LIST_FILES, async () => getConfiguredVaultFileSystem().listFiles())

  ipcMain.handle(VAULT_IPC_CHANNELS.READ_FILE, async (_, relativePath: unknown) => {
    if (typeof relativePath !== 'string') throw new Error('Vault relativePath 无效')
    return getConfiguredVaultFileSystem().readFile(relativePath)
  })

  ipcMain.handle(VAULT_IPC_CHANNELS.WRITE_FILE, async (_, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Vault 写入参数无效')
    const value = input as Record<string, unknown>
    if (typeof value.relativePath !== 'string' || typeof value.content !== 'string') {
      throw new Error('Vault relativePath 和 content 必须为字符串')
    }
    return getConfiguredVaultFileSystem().writeFile({
      relativePath: value.relativePath,
      content: value.content,
      expectedSha256: typeof value.expectedSha256 === 'string' ? value.expectedSha256 : undefined,
      createOnly: value.createOnly === true,
    })
  })

  ipcMain.handle(VAULT_IPC_CHANNELS.CREATE_UNTITLED_FILE, async () => createUntitledVaultFile())

  ipcMain.handle(VAULT_IPC_CHANNELS.CREATE_UNTITLED_FILE_IN_FOLDER, async (_, folderPath: unknown) => {
    if (typeof folderPath !== 'string') throw new Error('Vault 文件夹路径无效')
    return createUntitledVaultFileInFolder(folderPath)
  })

  ipcMain.handle(VAULT_IPC_CHANNELS.CREATE_FOLDER, async (_, relativePath: unknown): Promise<void> => {
    if (typeof relativePath !== 'string') throw new Error('Vault 文件夹路径无效')
    createVaultFolder(relativePath)
  })

  ipcMain.handle(VAULT_IPC_CHANNELS.RENAME_FILE, async (_, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Vault 重命名参数无效')
    const value = input as Record<string, unknown>
    if (typeof value.relativePath !== 'string' || typeof value.name !== 'string') {
      throw new Error('Vault relativePath 和 name 必须为字符串')
    }
    return getConfiguredVaultFileSystem().renameFile({
      relativePath: value.relativePath,
      name: value.name,
      expectedSha256: typeof value.expectedSha256 === 'string' ? value.expectedSha256 : undefined,
    })
  })

  ipcMain.handle(VAULT_IPC_CHANNELS.DELETE_FILE, async (_, input: unknown): Promise<void> => {
    if (!input || typeof input !== 'object') throw new Error('Vault 删除参数无效')
    const value = input as Record<string, unknown>
    if (typeof value.relativePath !== 'string') throw new Error('Vault relativePath 无效')
    getConfiguredVaultFileSystem().deleteFile({
      relativePath: value.relativePath,
      expectedSha256: typeof value.expectedSha256 === 'string' ? value.expectedSha256 : undefined,
    })
  })

  ipcMain.handle(VAULT_IPC_CHANNELS.SET_USER_CONTEXT, async (_, sessionId: unknown, focus: unknown, open: unknown): Promise<void> => {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0) throw new Error('Vault sessionId 无效')
    if (open === false || focus === null || focus === undefined) {
      clearVaultUserContext(sessionId)
      return
    }
    if (!focus || typeof focus !== 'object') throw new Error('Vault focus 无效')
    const value = focus as Record<string, unknown>
    if (
      (value.kind !== 'file' && value.kind !== 'folder')
      || typeof value.relativePath !== 'string'
      || !Number.isSafeInteger(value.sequence)
    ) {
      throw new Error('Vault focus 无效')
    }
    setVaultUserContext(sessionId, {
      kind: value.kind,
      relativePath: value.relativePath,
      sequence: value.sequence as number,
    })
  })


  ipcMain.handle(
    EXPERT_IPC_CHANNELS.CREATE,
    async (
      _,
      input: { id: string; label: string; identitySummary?: string; description?: string; avatar?: { icon?: string; accent?: string }; defaultProviderChannelId?: string; defaultModel?: string; skillSlugs?: string[] },
    ): Promise<ExpertPackage> => {
      if (!input || typeof input !== 'object') throw new Error('input 必须是对象')
      if (!isNonEmptyString(input.id)) throw new Error('id 必填')
      if (!isNonEmptyString(input.label)) throw new Error('label 必填')
      return createExpert(getExpertsDir(), {
        id: input.id,
        label: input.label,
        identitySummary: typeof input.identitySummary === 'string' ? input.identitySummary : undefined,
        description: typeof input.description === 'string' && input.description.length > 0 ? input.description : undefined,
        avatar: input.avatar && typeof input.avatar === 'object' ? input.avatar : undefined,
        defaultProviderChannelId: typeof input.defaultProviderChannelId === 'string' && input.defaultProviderChannelId.length > 0 ? input.defaultProviderChannelId : undefined,
        defaultModel: typeof input.defaultModel === 'string' && input.defaultModel.length > 0 ? input.defaultModel : undefined,
        skillSlugs: Array.isArray(input.skillSlugs) ? input.skillSlugs : undefined,
      })
    },
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.UPDATE_MANIFEST,
    async (
      _,
      id: string,
      patch: Partial<Pick<ExpertManifest, 'skillSlugs' | 'mcpIds' | 'label'>>,
    ): Promise<ExpertPackage> => {
      if (!isNonEmptyString(id)) throw new Error('id 必填')
      if (!patch || typeof patch !== 'object') throw new Error('patch 必须是对象')
      return updateExpertManifest(getExpertsDir(), id, patch)
    },
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.UPDATE_FILES,
    async (
      _,
      id: string,
      files: Partial<{ identityMd: string; soulMd: string; rulesMd: string }>,
    ): Promise<ExpertPackage> => {
      if (!isNonEmptyString(id)) throw new Error('id 必填')
      if (!files || typeof files !== 'object') throw new Error('files 必须是对象')
      return updateExpertFiles(getExpertsDir(), id, files)
    },
  )
}
