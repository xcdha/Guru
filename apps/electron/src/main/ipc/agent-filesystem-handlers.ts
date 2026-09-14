/**
 * agent-filesystem-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「Agent 文件系统操作」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { resolveAgentSessionFileRoots } from '../lib/agent-file-roots'
import { listSessionOutputs } from '../lib/agent-output-capture'
import { getAgentSessionMeta } from '../lib/agent-session-manager'
import { getAgentWorkspace, listAgentWorkspaces } from '../lib/agent-workspace-manager'
import { getAgentSessionWorkspacePath, getAgentWorkspacePath, getAgentWorkspacesDir, getWorkspaceFilesDir } from '../lib/config-paths'
import { isSafeDeleteTarget } from '../lib/destructive-file-policy'
import { listShallowDirectory } from '../lib/directory-listing'
import { normalizeFileAccessOptions } from '../lib/file-access-policy'
import { getWorkspaceMetadataDirNames } from '../lib/storage-boundaries'
import { getAuthorizedRoots, isPathAllowed, realpathOrResolve } from './path-access'
import { AGENT_IPC_CHANNELS } from '@guru/shared'
import type { FileAccessOptions, FileEntry } from '@guru/shared'
import { clipboard, ipcMain, shell } from 'electron'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

export function registerAgentFilesystemHandlers(): void {
  // ===== Agent 文件系统操作 =====

  // 获取 session 工作路径
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_SESSION_PATH,
    async (_, workspaceId: string, sessionId: string): Promise<string | null> => {
      const ws = getAgentWorkspace(workspaceId)
      if (!ws) return null
      return getAgentSessionWorkspacePath(ws.slug, sessionId)
    }
  )

  // 获取当前会话统一文件根。Project effective cwd 必须由主进程解析，renderer 不自行拼接托管路径。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_SESSION_FILE_ROOTS,
    async (_, workspaceId: string, sessionId: string) => {
      const ws = getAgentWorkspace(workspaceId)
      const sessionMeta = getAgentSessionMeta(sessionId)
      if (!ws || !sessionMeta || (sessionMeta.workspaceId && sessionMeta.workspaceId !== workspaceId)) return null
      return resolveAgentSessionFileRoots(sessionMeta, ws.slug)
    },
  )

  // 获取当前会话本轮捕获的文件产出；Outbox 不参与 @ Workspace Files 搜索。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_SESSION_OUTPUTS,
    async (_, workspaceId: string, sessionId: string) => {
      const ws = getAgentWorkspace(workspaceId)
      const sessionMeta = getAgentSessionMeta(sessionId)
      if (!ws || !sessionMeta || (sessionMeta.workspaceId && sessionMeta.workspaceId !== workspaceId)) return []
      return listSessionOutputs(getWorkspaceFilesDir(ws.slug), sessionId)
    },
  )

  // 列出目录内容（浅层，安全校验）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_DIRECTORY,
    async (_, dirPath: string, access?: FileAccessOptions): Promise<FileEntry[]> => {
      const safePath = resolve(dirPath)
      // 目录可能已被删除（如删除 Agent 会话后面板仍持有旧路径），优雅返回空列表。
      if (!existsSync(safePath)) return []
      if (!isPathAllowed(safePath, normalizeFileAccessOptions(access))) {
        // 路径可能刚好在 existsSync 与 realpath 校验之间被删除。
        if (!existsSync(safePath)) return []
        console.warn('[Agent 文件] 拒绝越界 list-directory:', safePath, 'sessionId=', access?.sessionId ?? '(none)')
        throw new Error('访问路径超出当前会话的授权范围')
      }

      return listShallowDirectory(safePath)
    }
  )

  // 删除文件或目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_FILE,
    async (_, filePath: string, access?: FileAccessOptions): Promise<void> => {
      const { rmSync } = await import('node:fs')
      const { resolve } = await import('node:path')

      const options = normalizeFileAccessOptions(access)
      const safePath = resolve(filePath)
      if (!isPathAllowed(safePath, options)) {
        throw new Error('访问路径超出当前会话的授权范围')
      }

      const allowedRoots = getAuthorizedRoots(options)
      const forbiddenRoots = listAgentWorkspaces().flatMap((workspace) => {
        const workspaceRoot = getAgentWorkspacePath(workspace.slug)
        return [
          workspaceRoot,
          ...getWorkspaceMetadataDirNames().map((dirname) => join(workspaceRoot, dirname)),
        ]
      })
      if (options?.sessionId) {
        const meta = getAgentSessionMeta(options.sessionId)
        const workspace = meta?.workspaceId ? getAgentWorkspace(meta.workspaceId) : undefined
        if (workspace) {
          forbiddenRoots.push(getAgentSessionWorkspacePath(workspace.slug, options.sessionId))
          // 工程目录本身不可作为删除目标（列表/打开已授权，删除受保护）
          if (workspace.projectRootPath) forbiddenRoots.push(workspace.projectRootPath)
        }
      }
      if (!isSafeDeleteTarget(
        realpathOrResolve(safePath),
        forbiddenRoots.map(realpathOrResolve),
        allowedRoots.map(realpathOrResolve),
      )) {
        throw new Error('不能删除 Workspace、Session 或其他受管访问根目录')
      }

      rmSync(safePath, { recursive: true, force: true })
      console.log(`[Agent 文件] 已删除: ${safePath}`)
    }
  )

  // 用系统默认应用打开文件
  ipcMain.handle(
    AGENT_IPC_CHANNELS.OPEN_FILE,
    async (_, filePath: string, access?: FileAccessOptions): Promise<void> => {
      const { resolve } = await import('node:path')

      const safePath = resolve(filePath)
      if (!isPathAllowed(safePath, normalizeFileAccessOptions(access))) {
        throw new Error('访问路径超出当前会话的授权范围')
      }

      await shell.openPath(safePath)
    }
  )

  // 将剪贴板文本写入临时预览文件
  ipcMain.handle(
    AGENT_IPC_CHANNELS.WRITE_CLIPBOARD_PREVIEW,
    async (_, filename: string, content: string): Promise<string> => {
      if (typeof filename !== 'string' || !filename) {
        throw new Error('filename 必须是非空字符串')
      }
      if (typeof content !== 'string') {
        throw new Error('content 必须是字符串')
      }

      const { isAbsolute, join, relative, resolve } = await import('node:path')
      const { tmpdir } = await import('node:os')
      const { existsSync, mkdirSync } = await import('node:fs')
      const { writeFile } = await import('node:fs/promises')

      const tmpDir = join(tmpdir(), 'guru-preview')
      if (!existsSync(tmpDir)) {
        mkdirSync(tmpDir, { recursive: true })
      }

      // 安全文件名：替换路径分隔符和特殊字符，防止目录穿越
      const safeFilename = filename.replace(/[<>:"/\\|?*]/g, '_').replace(/^\.+/, '_')
      const tmpPath = resolve(tmpDir, safeFilename)

      // 确保 resolve 后的路径仍在 tmpDir 内，兼容 Windows 路径分隔符
      const relativePath = relative(tmpDir, tmpPath)
      if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
        throw new Error('文件名越界')
      }

      await writeFile(tmpPath, content, 'utf-8')
      console.log(`[IPC] clipboard 预览文件已写入: ${tmpPath}`)
      return tmpPath
    }
  )

  // 在系统文件管理器中显示文件
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SHOW_IN_FOLDER,
    async (_, filePath: string, access?: FileAccessOptions): Promise<void> => {
      const { resolve } = await import('node:path')

      const safePath = resolve(filePath)
      if (!isPathAllowed(safePath, normalizeFileAccessOptions(access))) {
        throw new Error('访问路径超出当前会话的授权范围')
      }

      shell.showItemInFolder(safePath)
    }
  )

  // 使用 macOS 系统 Terminal 在指定文件夹打开
  ipcMain.handle(
    AGENT_IPC_CHANNELS.OPEN_FOLDER_IN_TERMINAL,
    async (_, folderPath: string, access?: FileAccessOptions): Promise<void> => {
      if (process.platform !== 'darwin') {
        throw new Error('当前仅支持在 macOS 终端中打开文件夹')
      }
      if (!isPathAllowed(folderPath, normalizeFileAccessOptions(access))) {
        throw new Error('访问路径超出当前会话的授权范围')
      }

      const { resolve } = await import('node:path')

      const safePath = resolve(folderPath)
      const workspacesRoot = resolve(getAgentWorkspacesDir())
      if (!safePath.startsWith(workspacesRoot)) {
        throw new Error('访问路径超出 Agent 工作区范围')
      }
      if (!statSync(safePath).isDirectory()) {
        throw new Error('只能在终端中打开文件夹')
      }

      const { spawn } = await import('node:child_process')
      await new Promise<void>((resolvePromise, reject) => {
        const child = spawn('open', ['-a', 'Terminal', safePath], { detached: true, stdio: 'ignore' })
        child.once('error', reject)
        child.once('spawn', () => {
          child.unref()
          resolvePromise()
        })
      })
    }
  )
}
