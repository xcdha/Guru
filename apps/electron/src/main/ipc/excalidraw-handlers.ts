/**
 * Excalidraw 画布 IPC 处理器
 *
 * 从 `src/main/ipc.ts` 抽出（2026-09-13 文件拆分）。原文件 7531 行 / 471 个
 * ipcMain.handle，按 banner 分组挑选「行数 / 依赖数」比最高的整块抽取。
 * 本文件只注册 Excalidraw 相关 channel，以及它们专用的标题归一化 / 重名解析辅助函数。
 */

import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { EXCALIDRAW_IPC_CHANNELS, SCRATCH_PAD_IPC_CHANNELS, SETTINGS_IPC_CHANNELS } from '../../types'
import { getExcalidrawDir } from '../lib/config-paths'

/** Excalidraw 文件标题 → slug 的唯一归一化实现，避免多个 handler 各自内联同一段正则导致规则漂移 */
function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w一-鿿぀-ヿ-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * 计算新建 Excalidraw 文件的最终文件名，自动追加 "(n)" 后缀避免重名。
 * CREATE 与 SAVE_SYNC（beforeunload 兜底保存新画布）共用同一份逻辑，避免两处判断标准
 * 分叉——历史上就因为 CREATE 与其他 handler 判断标准不一致导致过大小写覆盖之类的 bug。
 */
function resolveExcalidrawCreateName(dir: string, rawTitle: string): { finalName: string; filePath: string } {
  const safeName = rawTitle.trim().replace(/[\\/:*?"<>|]/g, '-') || '未命名画布'
  const existingSlugs = new Set(
    readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.excalidraw'))
      .map((e) => titleToSlug(e.name.slice(0, -'.excalidraw'.length))),
  )
  // existsSync 是 OS 级判断（正确处理 macOS/Windows 默认大小写不敏感文件系统），
  // existingSlugs 判断则防止不同标题归一化后产生同一份"逻辑文件"。
  const nameCollides = (candidate: string): boolean =>
    existsSync(join(dir, `${candidate}.excalidraw`)) || existingSlugs.has(titleToSlug(candidate))
  let finalName = safeName
  if (nameCollides(finalName)) {
    let i = 1
    while (nameCollides(`${safeName} (${i})`)) i++
    finalName = `${safeName} (${i})`
  }
  return { finalName, filePath: join(dir, `${finalName}.excalidraw`) }
}

export function registerExcalidrawHandlers(): void {
  // ===== Excalidraw 画布 =====

  // 列出 Workspace 下所有画板文件
  ipcMain.handle(
    EXCALIDRAW_IPC_CHANNELS.LIST,
    async (_, workspaceSlug: string) => {
      if (!workspaceSlug || typeof workspaceSlug !== 'string') return []
      const dir = getExcalidrawDir(workspaceSlug)
      try {
        const entries = readdirSync(dir, { withFileTypes: true })
        const files: Array<{
          slug: string
          title: string
          elementCount: number
          background: string
          mtime: number
          error?: boolean
          // 缩略图渲染用的精简元素快照（不含 files 内嵌图片大字段），
          // 供画廊直接绘制缩略图，避免再对每个文件发起一次 READ + JSON.parse。
          elements?: unknown[]
        }> = []

        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.excalidraw')) continue
          const filePath = join(dir, entry.name)
          const title = entry.name.slice(0, -'.excalidraw'.length)
          const slug = titleToSlug(title)
          try {
            const raw = readFileSync(filePath, 'utf-8')
            const data = JSON.parse(raw)
            const elements = (data.elements || []).filter((e: { isDeleted?: boolean }) => !e.isDeleted)
            files.push({
              slug,
              title,
              elementCount: elements.length,
              background: data.appState?.viewBackgroundColor || '#ffffff',
              mtime: statSync(filePath).mtimeMs,
              elements: elements.slice(0, 200),
            })
          } catch {
            files.push({ slug, title, elementCount: 0, background: '#ffffff', mtime: 0, error: true })
          }
        }

        return files.sort((a, b) => b.mtime - a.mtime)
      } catch (err) {
        console.error('[Excalidraw] 列出文件失败:', err)
        return []
      }
    }
  )

  // 读取单个画板文件
  ipcMain.handle(
    EXCALIDRAW_IPC_CHANNELS.READ,
    async (_, workspaceSlug: string, slug: string) => {
      if (!workspaceSlug || !slug) return null
      const dir = getExcalidrawDir(workspaceSlug)
      // 从文件系统找到匹配 slug 的文件
      try {
        const entries = readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.excalidraw')) continue
          const title = entry.name.slice(0, -'.excalidraw'.length)
          const entrySlug = titleToSlug(title)
          if (entrySlug !== slug) continue
          const raw = readFileSync(join(dir, entry.name), 'utf-8')
          const data = JSON.parse(raw)
          // 附带文件名派生的真实标题（未经 slug 归一化），供编辑器展示/持久化真实标题用
          return { ...data, title }
        }
        return null
      } catch (err) {
        console.error('[Excalidraw] 读取文件失败:', err)
        return null
      }
    }
  )

  // 新建空白画板文件
  ipcMain.handle(
    EXCALIDRAW_IPC_CHANNELS.CREATE,
    async (_, workspaceSlug: string, title: string) => {
      if (!workspaceSlug || !title?.trim()) throw new Error('参数无效')
      const dir = getExcalidrawDir(workspaceSlug)
      const { finalName, filePath } = resolveExcalidrawCreateName(dir, title)

      const data = {
        type: 'excalidraw',
        version: 2,
        source: 'guru',
        elements: [],
        appState: { viewBackgroundColor: '#ffffff' },
        files: {},
      }
      writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')

      const slug = titleToSlug(finalName)
      return { slug, title: finalName }
    }
  )

  // 保存画板文件
  ipcMain.handle(
    EXCALIDRAW_IPC_CHANNELS.WRITE,
    async (_, workspaceSlug: string, slug: string, payload: { elements?: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> }) => {
      if (!workspaceSlug || !slug) throw new Error('参数无效')
      const dir = getExcalidrawDir(workspaceSlug)

      // 找到匹配 slug 的文件
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.excalidraw')) continue
        const title = entry.name.slice(0, -'.excalidraw'.length)
        const entrySlug = titleToSlug(title)
        if (entrySlug !== slug) continue

        const filePath = join(dir, entry.name)
        // 读取现有文件（保留 files 数据中的嵌入图片）
        let existing: Record<string, unknown> = {}
        try {
          existing = JSON.parse(readFileSync(filePath, 'utf-8'))
        } catch { /* 现有文件损坏则覆盖 */ }

        const data = {
          type: 'excalidraw',
          version: 2,
          source: 'guru',
          elements: payload.elements || [],
          appState: payload.appState || (existing.appState as Record<string, unknown>) || {},
          // 以本次 payload.files 为准整体替换而非与历史 files 取并集：
          // 调用方（编辑器 getFiles()）返回的始终是场景当前引用到的完整文件集合，
          // 并集合并会导致已从画布删除的内嵌图片永久残留、文件体积单调增长。
          // 仅当调用方压根没传 files 字段时才回退保留旧值，避免误清空。
          files: payload.files !== undefined ? payload.files : ((existing.files as Record<string, unknown>) || {}),
        }
        await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
        return { ok: true }
      }

      throw new Error(`未找到文件: ${slug}`)
    }
  )

  // 导出到指定路径
  ipcMain.handle(
    EXCALIDRAW_IPC_CHANNELS.EXPORT,
    async (_, workspaceSlug: string, slug: string): Promise<string> => {
      if (!workspaceSlug || !slug) throw new Error('参数无效')
      const dir = getExcalidrawDir(workspaceSlug)

      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.excalidraw')) continue
        const title = entry.name.slice(0, -'.excalidraw'.length)
        const entrySlug = titleToSlug(title)
        if (entrySlug !== slug) continue

        const srcPath = join(dir, entry.name)
        const win = BrowserWindow.getFocusedWindow()
        if (!win) throw new Error('无活跃窗口')

        const result = await dialog.showSaveDialog(win, {
          title: '导出 Excalidraw 画布',
          defaultPath: `${title}.excalidraw`,
          filters: [
            { name: 'Excalidraw', extensions: ['excalidraw'] },
            { name: '所有文件', extensions: ['*'] },
          ],
        })

        if (result.canceled || !result.filePath) return ''
        copyFileSync(srcPath, result.filePath)
        return result.filePath
      }

      throw new Error(`未找到文件: ${slug}`)
    }
  )

  // 打开保存对话框选择导出路径
  ipcMain.handle(
    EXCALIDRAW_IPC_CHANNELS.CHOOSE_EXPORT_PATH,
    async (_, defaultName: string): Promise<string | null> => {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return null
      const result = await dialog.showSaveDialog(win, {
        title: '保存 Excalidraw 画布',
        defaultPath: defaultName || 'drawing.excalidraw',
        filters: [
          { name: 'Excalidraw', extensions: ['excalidraw'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      })
      return result.canceled ? null : result.filePath
    }
  )

  // 删除画板文件
  ipcMain.handle(
    EXCALIDRAW_IPC_CHANNELS.DELETE,
    async (_, workspaceSlug: string, slug: string) => {
      if (!workspaceSlug || !slug) throw new Error('参数无效')
      const dir = getExcalidrawDir(workspaceSlug)
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.excalidraw')) continue
        const title = entry.name.slice(0, -'.excalidraw'.length)
        const entrySlug = titleToSlug(title)
        if (entrySlug !== slug) continue
        rmSync(join(dir, entry.name))
        return { ok: true }
      }
      throw new Error(`未找到文件: ${slug}`)
    }
  )

  // 重命名画板文件
  ipcMain.handle(
    EXCALIDRAW_IPC_CHANNELS.RENAME,
    async (_, workspaceSlug: string, slug: string, newTitle: string) => {
      if (!workspaceSlug || !slug || !newTitle?.trim()) throw new Error('参数无效')
      const dir = getExcalidrawDir(workspaceSlug)
      const entries = readdirSync(dir, { withFileTypes: true })
      const safeTitle = newTitle.trim().replace(/[\\/:*?"<>|]/g, '-')
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.excalidraw')) continue
        const title = entry.name.slice(0, -'.excalidraw'.length)
        const entrySlug = titleToSlug(title)
        if (entrySlug !== slug) continue
        const oldPath = join(dir, entry.name)
        const newPath = join(dir, `${safeTitle}.excalidraw`)
        const newSlug = titleToSlug(safeTitle)
        if (oldPath !== newPath && existsSync(newPath)) {
          // existsSync 在 macOS/Windows 默认大小写不敏感文件系统上对纯大小写差异也会命中，
          // 用 inode 比较排除"改名后仍是同一份物理文件"（如 Plan → plan）的合法场景。
          const sameFile = (() => {
            try {
              const a = statSync(oldPath)
              const b = statSync(newPath)
              return a.dev === b.dev && a.ino === b.ino
            } catch {
              return false
            }
          })()
          if (!sameFile) throw new Error(`文件 "${safeTitle}" 已存在`)
        }
        if (oldPath !== newPath) {
          const collidesWithOther = entries.some((other) => {
            if (other.name === entry.name || !other.isFile() || !other.name.endsWith('.excalidraw')) return false
            return titleToSlug(other.name.slice(0, -'.excalidraw'.length)) === newSlug
          })
          if (collidesWithOther) throw new Error(`文件 "${safeTitle}" 与已有画布重名（归一化后冲突），请换一个名称`)
        }
        renameSync(oldPath, newPath)
        return { ok: true, slug: newSlug, title: safeTitle }
      }
      throw new Error(`未找到文件: ${slug}`)
    }
  )

  // 同步保存（beforeunload / 应用退出场景）：新画布走同步 CREATE，已有画布走同步 WRITE。
  // 对齐 SETTINGS_IPC_CHANNELS.UPDATE_SYNC / SCRATCH_PAD_IPC_CHANNELS.SAVE_SYNC 的既有约定——
  // beforeunload 里发起的异步 IPC 不保证等到窗口关闭前完成，必须用 sendSync 阻塞等待落盘。
  ipcMain.on(
    EXCALIDRAW_IPC_CHANNELS.SAVE_SYNC,
    (
      event,
      workspaceSlug: string,
      slug: string | null,
      title: string,
      payload: { elements?: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> },
    ) => {
      try {
        if (!workspaceSlug) {
          event.returnValue = null
          return
        }
        const dir = getExcalidrawDir(workspaceSlug)
        let filePath: string | null = null
        let finalSlug = slug
        let finalTitle = title

        if (slug) {
          const entries = readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.excalidraw')) continue
            if (titleToSlug(entry.name.slice(0, -'.excalidraw'.length)) !== slug) continue
            filePath = join(dir, entry.name)
            break
          }
        }

        if (!filePath) {
          const created = resolveExcalidrawCreateName(dir, title || '未命名画布')
          filePath = created.filePath
          finalSlug = titleToSlug(created.finalName)
          finalTitle = created.finalName
        }

        let existing: Record<string, unknown> = {}
        try {
          existing = JSON.parse(readFileSync(filePath, 'utf-8'))
        } catch { /* 新文件或已损坏，直接覆盖 */ }

        const data = {
          type: 'excalidraw',
          version: 2,
          source: 'guru',
          elements: payload.elements || [],
          appState: payload.appState || (existing.appState as Record<string, unknown>) || {},
          files: payload.files !== undefined ? payload.files : ((existing.files as Record<string, unknown>) || {}),
        }
        writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
        event.returnValue = { ok: true, slug: finalSlug, title: finalTitle }
      } catch (err) {
        console.error('[Excalidraw] 同步保存失败:', err)
        event.returnValue = null
      }
    }
  )
}
