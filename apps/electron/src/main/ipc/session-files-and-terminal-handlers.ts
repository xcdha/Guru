/**
 * session-files-and-terminal-handlers — 会话文件操作 + 内嵌终端（PTY）IPC 处理器
 *
 * 从 `src/main/ipc.ts` 抽出（2026-09-14 分批拆分的第三块，原 711 行）。
 * 覆盖 27 个 handler：
 * - 内嵌终端：TERMINAL_OPEN / WRITE / RESIZE / CLOSE / CLOSE_SESSION / BUFFER / GET_STATE
 * - 会话文件：RENAME_FILE / MOVE_FILE / CHECK_PATHS_TYPE / SEARCH_WORKSPACE_FILES / SHOW_ITEM_IN_FOLDER
 * - 附加目录与文件：LIST_ATTACHED_DIRECTORY / READ_ATTACHED_FILE / SHOW_ATTACHED_IN_FOLDER /
 *   RENAME_ATTACHED_FILE / MOVE_ATTACHED_FILE
 *
 * 模块名按实际内容命名（原 ipc.ts 的 banner 只写了「会话内嵌终端（PTY）」，
 * 实际块内还含会话文件操作，沿用 banner 名会误导）。
 * 该分组依赖全部来自其它模块（含已抽出的 `path-access`）与块内局部缓存
 * （workspaceFileSearchIndexCache 等），可整块搬移，无需依赖注入。
 */

import type { FileAccessOptions, FileEntry, FileSearchResult, ResolvedFileUrl } from '@guru/shared'
import { AGENT_IPC_CHANNELS, IPC_CHANNELS, MAX_ATTACHMENT_SIZE } from '@guru/shared'
import { agentTerminalController } from '../lib/agent-terminal'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { getAgentSessionMeta } from '../lib/agent-session-manager'
import { getAgentWorkspace, getWorkspaceAttachedDirectories, getWorkspaceAttachedFiles } from '../lib/agent-workspace-manager'
import { getAgentWorkspacesDir, getWorkspaceFilesDir } from '../lib/config-paths'
import { getAllowedCandidateBasePaths, getPreviewCandidateBasePaths, getResolvedAuthorizedRoots, isPathAllowed, isResolvedPathAllowed } from './path-access'
import { ipcMain, shell } from 'electron'
import { listShallowDirectory } from '../lib/directory-listing'
import { normalizeFileAccessOptions } from '../lib/file-access-policy'
import { realpath, stat } from 'node:fs/promises'
import { registerGuruDirectoryPath, registerGuruFilePath } from '../lib/local-file-protocol'
import { resolveAgentSessionFileRoots } from '../lib/agent-file-roots'

export function registerSessionFilesAndTerminalHandlers(): void {
  // ===== 会话内嵌终端（PTY） =====
  // 所有 Agent 会话可用；cwd 复用 resolveAgentSessionFileRoots（= resolveSessionCwd）：
  // 绑定 project/worktree 时为其目录，未绑定项目时回退会话沙箱目录，与 Agent 执行上下文一致。
  // 多终端：terminalId = `<sessionId>#<instanceId>`，实例级操作按 terminalId 路由。

  // 打开（或复用）终端实例
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TERMINAL_OPEN,
    async (_, input: import('@guru/shared').TerminalOpenInput): Promise<import('@guru/shared').TerminalViewState> => {
      const session = getAgentSessionMeta(input.sessionId)
      if (!session) throw new Error('会话不存在')
      const ws = session.workspaceId ? getAgentWorkspace(session.workspaceId) : undefined
      if (!ws) throw new Error('会话未绑定工作区，无法启动终端')
      const roots = resolveAgentSessionFileRoots(session, ws.slug)
      const cwd = roots.executionCwd
      if (!cwd) throw new Error('无法解析会话工作目录')
      return agentTerminalController.open({ ...input, cwd })
    }
  )

  // 写入终端输入
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TERMINAL_WRITE,
    (_event, input: import('@guru/shared').TerminalWriteInput): void => {
      agentTerminalController.write(input)
    }
  )

  // 调整终端尺寸
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TERMINAL_RESIZE,
    (_event, input: import('@guru/shared').TerminalResizeInput): void => {
      agentTerminalController.resize(input)
    }
  )

  // 关闭单个终端实例
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TERMINAL_CLOSE,
    (_event, input: import('@guru/shared').TerminalCloseInput): import('@guru/shared').TerminalViewState | null => {
      return agentTerminalController.close(input)
    }
  )

  // 关闭会话全部终端实例（面板整体关闭）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TERMINAL_CLOSE_SESSION,
    (_event, sessionId: string): void => {
      agentTerminalController.closeSession(sessionId)
    }
  )

  // 拉取并清空输出缓冲（面板挂载时回放预启动期间的历史输出）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TERMINAL_BUFFER,
    (_event, terminalId: string): string => {
      return agentTerminalController.drainBuffer(terminalId)
    }
  )

  // 获取终端状态
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TERMINAL_GET_STATE,
    (_event, terminalId: string): import('@guru/shared').TerminalViewState | null => {
      return agentTerminalController.getState(terminalId)
    }
  )

  // 在系统文件管理器中显示任意路径（无工作区限制，用户主动点击触发）
  ipcMain.handle(
    IPC_CHANNELS.SHOW_ITEM_IN_FOLDER,
    async (_, filePath: string, candidateBasePaths?: string[]): Promise<boolean> => {
      const { resolve } = await import('node:path')
      const { existsSync } = await import('node:fs')
      const { resolveTargetPath } = await import('../lib/file-preview-service')

      const resolvedPath = resolveTargetPath(filePath, candidateBasePaths?.length ? candidateBasePaths : undefined)
      if (!existsSync(resolvedPath)) {
        console.warn('[IPC] shell:show-item-in-folder 路径不存在:', resolvedPath)
        return false
      }
      shell.showItemInFolder(resolve(resolvedPath))
      return true
    }
  )

  // 解析文件路径并读取内容（供内联预览使用）
  ipcMain.handle(
    'file:resolve-and-read',
    async (_, filePath: string, access?: FileAccessOptions | string[]): Promise<{ resolvedPath: string; content: string; isBinary: boolean; isTooLarge: boolean } | null> => {
      const { resolveAndReadFile, resolveFilePath } = await import('../lib/file-preview-service')
      const options = normalizeFileAccessOptions(access)
      const allowedBasePaths = getAllowedCandidateBasePaths(options)
      const resolved = resolveFilePath(filePath, allowedBasePaths)
      if (!resolved || !isPathAllowed(resolved, options)) {
        console.warn('[IPC] file:resolve-and-read 拒绝越界路径:', resolved ?? filePath)
        return null
      }
      const result = resolveAndReadFile(resolved)
      return result
    }
  )

  // 写入文本文件（供 Markdown 内联编辑使用）
  ipcMain.handle(
    'file:write-text',
    async (_, filePath: string, content: string, access?: FileAccessOptions | string[]): Promise<boolean> => {
      if (typeof content !== 'string') return false
      const { writeFileSync } = await import('node:fs')
      const { resolveFilePath } = await import('../lib/file-preview-service')
      const options = normalizeFileAccessOptions(access)
      const allowedBasePaths = getAllowedCandidateBasePaths(options)
      const resolved = resolveFilePath(filePath, allowedBasePaths)
      if (!resolved || !isPathAllowed(resolved, options)) {
        console.warn('[IPC] file:write-text 拒绝越界路径:', resolved ?? filePath)
        return false
      }
      writeFileSync(resolved, content, 'utf-8')
      return true
    }
  )

  // 批量检查文件是否仍存在（供渲染端清理已删除的会话文件变更记录）。
  // 只接受绝对路径；以有限并发异步执行，避免慢盘或网络路径阻塞 Electron 主进程。
  ipcMain.handle(
    'file:exists-batch',
    async (_, filePaths: unknown, access?: FileAccessOptions | string[]): Promise<string[]> => {
      if (!Array.isArray(filePaths)) return []
      const options = normalizeFileAccessOptions(access)
      const candidates = filePaths.slice(0, 1000).filter(
        (rawPath): rawPath is string => typeof rawPath === 'string' && rawPath.length > 0 && isAbsolute(rawPath),
      )
      const resolvedRoots = options?.unrestricted ? [] : await getResolvedAuthorizedRoots(options)
      const existing = new Array<boolean>(candidates.length).fill(false)
      let nextIndex = 0
      const checkNext = async (): Promise<void> => {
        while (nextIndex < candidates.length) {
          const index = nextIndex++
          const filePath = candidates[index]!
          try {
            if (!(await stat(filePath)).isFile()) continue
            if (options?.unrestricted) {
              existing[index] = true
              continue
            }
            const resolvedPath = await realpath(filePath)
            existing[index] = isResolvedPathAllowed(resolvedPath, resolvedRoots)
          } catch {
            // 不存在、不可读或不在授权路径内：视为已删除。
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(candidates.length, 32) }, checkNext))
      return candidates.filter((_, index) => existing[index])
    },
  )

  // 仅解析文件路径（供 PDF/图片等用 guru-file:// 加载）
  // 安全边界：与 file:resolve-and-read 一致——只有通过 isPathAllowed 校验的
  // 已授权文件才会回传 resolvedPath 真实绝对路径（渲染端仅能拿到自己授权范围内
  // 的文件真实路径，与既有 resolveAndReadFile 泄露面相同）；token-gated URL
  // 仍然只对已授权文件可用。
  ipcMain.handle(
    'file:resolve-path',
    async (_, filePath: string, access?: FileAccessOptions | string[]): Promise<(ResolvedFileUrl & { resolvedPath: string }) | null> => {
      const { resolveFilePath } = await import('../lib/file-preview-service')
      const options = normalizeFileAccessOptions(access)
      const result = resolveFilePath(filePath, getAllowedCandidateBasePaths(options))
      if (result && !isPathAllowed(result, options)) {
        console.warn('[IPC] file:resolve-path 拒绝越界路径:', result)
        return null
      }
      if (!result) return null
      // registerGuruFilePath 对目录路径会抛「不是文件」。渲染端（如悬浮预览解析 markdown
      // 链接）可能传入目录路径，此处优雅降级为 null，而不是让异常冒泡成未捕获的 handler 错误。
      try {
        return { url: registerGuruFilePath(result), resolvedPath: result }
      } catch (err) {
        console.warn('[IPC] file:resolve-path 无法注册为文件，跳过:', result, err instanceof Error ? err.message : err)
        return null
      }
    }
  )

  // 为 HTML 预览注册所在目录，使相对 CSS、脚本和图片资源保持可加载。
  // 返回的仍是 token-gated guru-file URL，不向渲染进程泄露本机绝对路径。
  ipcMain.handle(
    'file:resolve-html-preview-path',
    async (_, filePath: string, access?: FileAccessOptions | string[]): Promise<ResolvedFileUrl | null> => {
      const { resolveFilePath } = await import('../lib/file-preview-service')
      const options = normalizeFileAccessOptions(access)
      const result = resolveFilePath(filePath, getPreviewCandidateBasePaths(options))
      if (!result) return null
      try {
        const directoryUrl = registerGuruDirectoryPath(dirname(result))
        return { url: `${directoryUrl}/${encodeURIComponent(basename(result))}` }
      } catch (err) {
        console.warn('[IPC] file:resolve-html-preview-path 无法注册预览目录，跳过:', result, err instanceof Error ? err.message : err)
        return null
      }
    }
  )

  // 为内联 PDF 预览生成临时 HTML 文件，返回文件路径
  ipcMain.handle(
    'file:prepare-pdf-preview',
    async (_, filePath: string, access?: FileAccessOptions | string[]): Promise<{ tmpHtmlUrl: string } | null> => {
      const { preparePdfPreview, resolveFilePath } = await import('../lib/file-preview-service')
      const options = normalizeFileAccessOptions(access)
      const allowedBasePaths = getAllowedCandidateBasePaths(options)
      const resolved = resolveFilePath(filePath, allowedBasePaths)
      if (!resolved || !isPathAllowed(resolved, options)) {
        console.warn('[IPC] file:prepare-pdf-preview 拒绝越界路径:', resolved ?? filePath)
        return null
      }
      const result = await preparePdfPreview(resolved)
      return result ? { tmpHtmlUrl: result.tmpHtmlUrl } : null
    }
  )

  // 为内联 HTML 预览注册文件所在目录 URL（相对路径资源自动解析）
  ipcMain.handle(
    'file:prepare-html-preview',
    async (_, filePath: string, access?: FileAccessOptions | string[]): Promise<{ tmpUrl: string } | null> => {
      const { prepareHtmlPreview, resolveFilePath } = await import('../lib/file-preview-service')
      const options = normalizeFileAccessOptions(access)
      const allowedBasePaths = getAllowedCandidateBasePaths(options)
      const resolved = resolveFilePath(filePath, allowedBasePaths)
      if (!resolved || !isPathAllowed(resolved, options)) {
        console.warn('[IPC] file:prepare-html-preview 拒绝越界路径:', resolved ?? filePath)
        return null
      }
      const result = await prepareHtmlPreview(resolved)
      return result ? { tmpUrl: result.tmpUrl } : null
    }
  )

  // DOCX 转 HTML（内联预览使用 mammoth）
  ipcMain.handle(
    'file:docx-to-html',
    async (_, filePath: string, access?: FileAccessOptions | string[]): Promise<{ resolvedPath: string; html: string } | null> => {
      const { convertDocxToHtml, resolveFilePath } = await import('../lib/file-preview-service')
      const options = normalizeFileAccessOptions(access)
      const allowedBasePaths = getAllowedCandidateBasePaths(options)
      const resolved = resolveFilePath(filePath, allowedBasePaths)
      if (!resolved || !isPathAllowed(resolved, options)) {
        console.warn('[IPC] file:docx-to-html 拒绝越界路径:', resolved ?? filePath)
        return null
      }
      const result = await convertDocxToHtml(resolved)
      return result
    }
  )

  // XLSX/PPTX 转 HTML（内联预览使用 OOXML 解析）
  ipcMain.handle(
    'file:office-to-html',
    async (_, filePath: string, access?: FileAccessOptions | string[]): Promise<import('@guru/shared').OfficePreviewResult | null> => {
      const { convertOfficeToHtml, resolveFilePath } = await import('../lib/file-preview-service')
      const options = normalizeFileAccessOptions(access)
      const allowedBasePaths = getAllowedCandidateBasePaths(options)
      const resolved = resolveFilePath(filePath, allowedBasePaths)
      if (!resolved || !isPathAllowed(resolved, options)) {
        console.warn('[IPC] file:office-to-html 拒绝越界路径:', resolved ?? filePath)
        return null
      }
      return convertOfficeToHtml(resolved)
    }
  )

  // 读取文件为 base64（带路径校验，供内联图片预览等使用）
  ipcMain.handle(
    'file:read-binary-base64',
    async (_, filePath: string, access?: FileAccessOptions | string[], maxSize?: number): Promise<string | null> => {
      const { readFileSync, statSync } = await import('node:fs')
      const { resolveFilePath } = await import('../lib/file-preview-service')
      const options = normalizeFileAccessOptions(access)
      const resolved = resolveFilePath(filePath, getAllowedCandidateBasePaths(options))
      if (!resolved || !isPathAllowed(resolved, options)) return null
      const st = statSync(resolved)
      if (st.size > MAX_ATTACHMENT_SIZE) return null
      return readFileSync(resolved).toString('base64')
    }
  )

  // 重命名文件/目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.RENAME_FILE,
    async (_, filePath: string, newName: string, access?: FileAccessOptions): Promise<void> => {
      const { renameSync } = await import('node:fs')
      const { resolve, dirname, join, sep } = await import('node:path')

      if (newName.includes('/') || newName.includes('\\') || newName.includes('..') || newName.includes(sep)) {
        throw new Error('文件名不能包含路径分隔符或 ".."')
      }

      const safePath = resolve(filePath)
      if (!isPathAllowed(safePath, normalizeFileAccessOptions(access))) {
        throw new Error('访问路径超出当前会话的授权范围')
      }

      const newPath = join(dirname(safePath), newName)
      renameSync(safePath, newPath)
      console.log(`[Agent 文件] 已重命名: ${safePath} → ${newPath}`)
    }
  )

  // 移动文件/目录到目标目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.MOVE_FILE,
    async (_, filePath: string, targetDir: string, access?: FileAccessOptions): Promise<void> => {
      const { renameSync } = await import('node:fs')
      const { resolve, basename, join } = await import('node:path')

      const safePath = resolve(filePath)
      const safeTarget = resolve(targetDir)
      const options = normalizeFileAccessOptions(access)
      if (!isPathAllowed(safePath, options) || !isPathAllowed(safeTarget, options)) {
        throw new Error('访问路径超出当前会话的授权范围')
      }

      const newPath = join(safeTarget, basename(safePath))
      renameSync(safePath, newPath)
      console.log(`[Agent 文件] 已移动: ${safePath} → ${newPath}`)
    }
  )

  // 列出附加目录内容
  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_ATTACHED_DIRECTORY,
    async (_, dirPath: string, access?: FileAccessOptions | string[]): Promise<FileEntry[]> => {
      const safePath = resolve(dirPath)
      const options = normalizeFileAccessOptions(access)
      if (!isPathAllowed(safePath, options)) {
        // 已解绑或被删除的附加目录不应让文件面板持续报错。
        if (!existsSync(safePath)) return []
        throw new Error('访问路径不在允许范围内')
      }

      return listShallowDirectory(safePath)
    }
  )

  // 读取附加目录文件内容为 base64（限制在已附加目录范围内，用于侧面板添加到聊天）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.READ_ATTACHED_FILE,
    async (_, filePath: string, sessionId?: string, workspaceSlug?: string): Promise<string> => {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('无效的文件路径')
      }

      const { resolve, sep } = await import('node:path')
      const { readFile, stat, realpath } = await import('node:fs/promises')

      // 使用 realpath 解析符号链接，防止 symlink 绕过路径检查
      const safePath = await realpath(resolve(filePath)).catch(() => {
        throw new Error(`文件不存在: ${filePath}`)
      })

      // 收集所有允许的路径：会话/工作区附加目录、附加文件 + 工作区文件目录
      const allowedDirs: string[] = []
      const allowedFiles: string[] = []

      if (sessionId) {
        const meta = getAgentSessionMeta(sessionId)
        if (meta?.attachedDirectories) {
          allowedDirs.push(...meta.attachedDirectories)
        }
        if (meta?.attachedFiles) {
          allowedFiles.push(...meta.attachedFiles)
        }
      }
      if (workspaceSlug) {
        allowedDirs.push(...getWorkspaceAttachedDirectories(workspaceSlug))
        allowedFiles.push(...getWorkspaceAttachedFiles(workspaceSlug))
        allowedDirs.push(getWorkspaceFilesDir(workspaceSlug))
      }

      // 还允许访问 agent-workspaces 根目录下的文件（session 文件等）
      allowedDirs.push(getAgentWorkspacesDir())

      const resolvedAllowedDirs = await Promise.all(
        allowedDirs.map((dir) => realpath(resolve(dir)).catch(() => resolve(dir)))
      )
      const resolvedAllowedFiles = await Promise.all(
        allowedFiles.map((file) => realpath(resolve(file)).catch(() => resolve(file)))
      )
      const isAllowed = resolvedAllowedDirs.some((dir) => safePath.startsWith(dir + sep) || safePath === dir)
        || resolvedAllowedFiles.some((file) => safePath === file)
      if (!isAllowed) {
        throw new Error('访问路径不在允许范围内')
      }

      const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB
      const fileStat = await stat(safePath).catch(() => null)
      if (!fileStat) {
        throw new Error(`文件不存在: ${filePath}`)
      }
      if (fileStat.size > MAX_FILE_SIZE) {
        throw new Error(`文件过大（${Math.round(fileStat.size / 1024 / 1024)}MB），最大支持 20MB`)
      }

      const buffer = await readFile(safePath)
      return buffer.toString('base64')
    }
  )

  // 在文件管理器中显示附加目录文件
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SHOW_ATTACHED_IN_FOLDER,
    async (_, filePath: string, access?: FileAccessOptions | string[]): Promise<void> => {
      const { resolve } = await import('node:path')
      const safePath = resolve(filePath)
      const options = normalizeFileAccessOptions(access)
      if (!isPathAllowed(safePath, options)) {
        console.warn('[IPC] show-attached-in-folder 拒绝越界路径:', safePath)
        return
      }
      shell.showItemInFolder(safePath)
    }
  )

  // 重命名附加目录文件/目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.RENAME_ATTACHED_FILE,
    async (_, filePath: string, newName: string, access?: FileAccessOptions | string[]): Promise<void> => {
      const { renameSync } = await import('node:fs')
      const { resolve, dirname, join, sep } = await import('node:path')

      if (newName.includes('/') || newName.includes('\\') || newName.includes('..') || newName.includes(sep)) {
        throw new Error('文件名不能包含路径分隔符或 ".."')
      }
      const safePath = resolve(filePath)
      const options = normalizeFileAccessOptions(access)
      if (!isPathAllowed(safePath, options)) {
        throw new Error('访问路径不在允许范围内')
      }
      const newPath = join(dirname(safePath), newName)
      renameSync(safePath, newPath)
      console.log(`[附加目录] 已重命名: ${safePath} → ${newPath}`)
    }
  )

  // 移动附加目录文件/目录
  ipcMain.handle(
    AGENT_IPC_CHANNELS.MOVE_ATTACHED_FILE,
    async (_, filePath: string, targetDir: string, access?: FileAccessOptions | string[]): Promise<void> => {
      const { renameSync } = await import('node:fs')
      const { resolve, basename, join } = await import('node:path')

      const safePath = resolve(filePath)
      const safeTarget = resolve(targetDir)
      const options = normalizeFileAccessOptions(access)
      if (!isPathAllowed(safePath, options) || !isPathAllowed(safeTarget, options)) {
        throw new Error('访问路径不在允许范围内')
      }
      const newPath = join(safeTarget, basename(safePath))
      renameSync(safePath, newPath)
      console.log(`[附加目录] 已移动: ${safePath} → ${newPath}`)
    }
  )

  // 检查路径类型（文件 or 目录），用于拖拽检测
  ipcMain.handle(
    AGENT_IPC_CHANNELS.CHECK_PATHS_TYPE,
    async (_, paths: string[]): Promise<{ directories: string[]; files: string[] }> => {
      const { statSync } = await import('node:fs')
      const directories: string[] = []
      const files: string[] = []
      for (const p of paths) {
        try {
          const stat = statSync(p)
          if (stat.isDirectory()) {
            directories.push(p)
          } else {
            files.push(p)
          }
        } catch {
          // 无法访问的路径忽略
        }
      }
      return { directories, files }
    }
  )

  // 搜索工作区文件（用于 @ 引用，递归扫描，支持附加目录）
  type WorkspaceFileSearchEntry = {
    name: string
    path: string
    type: 'file' | 'dir'
    source: 'session' | 'workspace'
  }
  const workspaceFileSearchIndexCache = new Map<string, {
    expiresAt: number
    rootEntries: WorkspaceFileSearchEntry[]
    workspaceEntries: WorkspaceFileSearchEntry[]
  }>()
  const WORKSPACE_FILE_INDEX_CACHE_TTL_MS = 3_000
  const WORKSPACE_FILE_INDEX_CACHE_MAX_ENTRIES = 20

  ipcMain.handle(
    AGENT_IPC_CHANNELS.SEARCH_WORKSPACE_FILES,
    async (_, rootPath: string, query: string, limit = 20, additionalPaths?: string[], sessionPaths?: string[]): Promise<FileSearchResult> => {
      const { readdirSync, statSync } = await import('node:fs')
      const { resolve, relative, basename } = await import('node:path')

      const safeRoot = resolve(rootPath)
      const resolvedAdditionalPaths = (additionalPaths ?? []).map((entry) => resolve(entry))
      const resolvedSessionPaths = (sessionPaths ?? []).map((entry) => resolve(entry))
      const ignoreDirs = new Set(['node_modules', '.git', 'dist', '.next', '__pycache__', '.venv', 'build', '.cache'])
      const ignoreFiles = new Set(['.DS_Store', '.Spotlight-V100', '.Trashes', 'Thumbs.db', 'desktop.ini'])
      const BROWSE_LIMIT_PER_GROUP = 2000
      const BROWSE_TOTAL_CAP = 3000
      const INDEX_ENTRY_CAP_PER_GROUP = 10_000

      // 按来源分组收集文件
      type Entry = WorkspaceFileSearchEntry
      let rootEntries: Entry[] = []
      let workspaceEntries: Entry[] = []

      function scan(
        dir: string,
        depth: number,
        baseRoot: string,
        target: Entry[],
        useAbsPath: boolean,
        source: 'session' | 'workspace',
      ): void {
        if (depth > 10 || target.length >= INDEX_ENTRY_CAP_PER_GROUP) return
        try {
          const items = readdirSync(dir, { withFileTypes: true })
          for (const item of items) {
            if (target.length >= INDEX_ENTRY_CAP_PER_GROUP) break
            if (ignoreFiles.has(item.name)) continue
            if (item.isDirectory() && ignoreDirs.has(item.name)) continue

            const fullPath = resolve(dir, item.name)
            const entryPath = useAbsPath ? fullPath : relative(baseRoot, fullPath)
            target.push({
              name: item.name,
              path: entryPath,
              type: item.isDirectory() ? 'dir' : 'file',
              source,
            })

            if (item.isDirectory()) {
              scan(fullPath, depth + 1, baseRoot, target, useAbsPath, source)
            }
          }
        } catch {
          // 忽略无权限的目录
        }
      }

      function addAttachedPath(pathValue: string, target: Entry[], source: 'session' | 'workspace'): void {
        if (target.length >= INDEX_ENTRY_CAP_PER_GROUP) return
        try {
          const attachedPath = resolve(pathValue)
          const name = basename(attachedPath)
          if (ignoreFiles.has(name)) return

          const stats = statSync(attachedPath)
          if (stats.isFile()) {
            if (target.length >= INDEX_ENTRY_CAP_PER_GROUP) return
            target.push({
              name,
              path: attachedPath,
              type: 'file',
              source,
            })
            return
          }

          if (!stats.isDirectory()) return
          if (ignoreDirs.has(name)) return

          if (target.length >= INDEX_ENTRY_CAP_PER_GROUP) return
          target.push({
            name: name === 'workspace-files' ? '工作文件' : name,
            path: attachedPath,
            type: 'dir',
            source,
          })
          scan(attachedPath, 0, attachedPath, target, true, source)
        } catch {
          // 忽略不存在或无权限的附加路径
        }
      }

      const cacheKey = JSON.stringify([safeRoot, resolvedAdditionalPaths, resolvedSessionPaths])
      const now = Date.now()
      const cachedIndex = workspaceFileSearchIndexCache.get(cacheKey)
      if (cachedIndex && cachedIndex.expiresAt > now) {
        // 查询排序会原地修改数组；每次从缓存复制外壳，索引条目本身保持只读复用。
        rootEntries = [...cachedIndex.rootEntries]
        workspaceEntries = [...cachedIndex.workspaceEntries]
      } else {
        // session 目录：相对路径
        scan(safeRoot, 0, safeRoot, rootEntries, false, 'session')

        // 会话级附加路径：绝对路径，标记为 session（归入会话文件分组）
        for (const sessionPath of resolvedSessionPaths) {
          addAttachedPath(sessionPath, rootEntries, 'session')
        }

        // 工作区文件 + 工作区级附加路径：绝对路径，标记为 workspace
        for (const additionalPath of resolvedAdditionalPaths) {
          addAttachedPath(additionalPath, workspaceEntries, 'workspace')
        }

        for (const [key, cached] of workspaceFileSearchIndexCache) {
          if (cached.expiresAt <= now) workspaceFileSearchIndexCache.delete(key)
        }
        while (workspaceFileSearchIndexCache.size >= WORKSPACE_FILE_INDEX_CACHE_MAX_ENTRIES) {
          const oldestKey = workspaceFileSearchIndexCache.keys().next().value
          if (typeof oldestKey !== 'string') break
          workspaceFileSearchIndexCache.delete(oldestKey)
        }
        workspaceFileSearchIndexCache.set(cacheKey, {
          expiresAt: now + WORKSPACE_FILE_INDEX_CACHE_TTL_MS,
          rootEntries: [...rootEntries],
          workspaceEntries: [...workspaceEntries],
        })
      }

      // 组内排序：目录优先，前缀匹配优先，路径短优先
      function sortGroup(entries: Entry[], q: string): void {
        entries.sort((a, b) => {
          const aStartsWith = a.name.toLowerCase().startsWith(q) ? 0 : 1
          const bStartsWith = b.name.toLowerCase().startsWith(q) ? 0 : 1
          if (aStartsWith !== bStartsWith) return aStartsWith - bStartsWith
          if (a.type === 'dir' && b.type !== 'dir') return -1
          if (a.type !== 'dir' && b.type === 'dir') return 1
          return a.path.length - b.path.length
        })
      }

      function matchEntries(entries: Entry[], q: string): Entry[] {
        return entries.filter((entry) => {
          const nameLower = entry.name.toLowerCase()
          const pathLower = entry.path.toLowerCase()
          if (nameLower.startsWith(q)) return true
          if (nameLower.includes(q) || pathLower.includes(q)) return true
          let qi = 0
          for (let i = 0; i < nameLower.length && qi < q.length; i++) {
            if (nameLower[i] === q[qi]) qi++
          }
          return qi === q.length
        })
      }

      // 目录优先排序：确保截断前所有目录（特别是顶层目录）排在前面
      function sortDirsFirst(entries: Entry[]): void {
        entries.sort((a, b) => {
          if (a.type === 'dir' && b.type !== 'dir') return -1
          if (a.type !== 'dir' && b.type === 'dir') return 1
          return a.path.length - b.path.length || a.name.localeCompare(b.name)
        })
      }

      const q = query.toLowerCase()

      if (!q) {
        // 空 query：目录优先排序后再截断，保证文件夹结构完整可见
        sortDirsFirst(rootEntries)
        sortDirsFirst(workspaceEntries)
        const maxPerGroup = Math.max(limit, BROWSE_LIMIT_PER_GROUP)
        const sessionSlice = rootEntries.slice(0, maxPerGroup)
        const workspaceSlice = workspaceEntries.slice(0, maxPerGroup)
        const combined = [...sessionSlice, ...workspaceSlice]
        const capped = combined.length > BROWSE_TOTAL_CAP ? combined.slice(0, BROWSE_TOTAL_CAP) : combined
        return {
          entries: capped,
          total: rootEntries.length + workspaceEntries.length,
          sessionEntries: sessionSlice,
          workspaceEntries: workspaceSlice,
        }
      }

      const sessionMatched = matchEntries(rootEntries, q)
      const workspaceMatched = matchEntries(workspaceEntries, q)
      sortGroup(sessionMatched, q)
      sortGroup(workspaceMatched, q)

      const totalMatched = sessionMatched.length + workspaceMatched.length
      let sessionSlice: Entry[]
      let workspaceSlice: Entry[]
      if (totalMatched <= limit) {
        sessionSlice = sessionMatched
        workspaceSlice = workspaceMatched
      } else {
        const sessionQuota = Math.max(
          sessionMatched.length > 0 ? 1 : 0,
          Math.round(limit * sessionMatched.length / totalMatched),
        )
        const workspaceQuota = Math.max(
          workspaceMatched.length > 0 ? 1 : 0,
          limit - sessionQuota,
        )
        sessionSlice = sessionMatched.slice(0, sessionQuota)
        workspaceSlice = workspaceMatched.slice(0, workspaceQuota)
      }

      return {
        entries: [...sessionSlice, ...workspaceSlice],
        total: sessionMatched.length + workspaceMatched.length,
        sessionEntries: sessionSlice,
        workspaceEntries: workspaceSlice,
      }
    }
  )
}
