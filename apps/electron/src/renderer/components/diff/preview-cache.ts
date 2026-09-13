/**
 * preview-cache — 文件预览的内容 LRU 缓存与滚动位置缓存
 *
 * 为什么单独成模块（2026-09-13）：
 * `LeftSidebar` 在关闭会话时只需调用 `clearPreviewCacheForSession`。原先该函数
 * 定义在 `DiffTabContent.tsx` 中，导致「为清一个缓存」而把整个预览编辑器的依赖图
 * （MarkdownRichEditor → markdown-preview-extensions → katex / @pierre/diffs /
 * dompurify / prosemirror 等，合计约 1.2MB 渲染体积）静态拉进首屏入口包。
 *
 * 拆出后 `DiffTabContent` 与 `LeftSidebar` 都从这里导入，缓存语义不变。
 * 本模块只依赖 `@/lib/markdown-editor-state`（无重依赖），可安全被入口路径引用。
 */

import { clearMarkdownEditorStateForSession } from '@/lib/markdown-editor-state'

/**
 * 内容缓存的 value。
 *
 * 说明：缓存 key 里带了 refreshVersion，refreshVersion 变化时（agent 写文件、git 突变）
 * key 自然变化，老 entry 不会被命中，最终被 LRU 淘汰；无需主动失效。
 */
export type CacheEntry = {
  oldContent: string
  newContent: string
  /** 非文本文件预览数据 */
  pdfSrc?: string
  htmlUrl?: string
  videoUrl?: string
  imageDataUrl?: string
  imagePath?: string
  docxHtml?: string
  officeHtml?: string
  officeText?: string
  /** HTML 预览的目录级 token URL，允许加载同目录相对资源 */
  htmlPreviewUrl?: string
  /** 二进制或其他不可安全内联渲染的文件提示 */
  unsupportedPreviewReason?: string
}

const CACHE_MAX = 50

export const contentCache = new Map<string, CacheEntry>()

export function cacheGet(key: string): CacheEntry | undefined {
  const v = contentCache.get(key)
  if (!v) return undefined
  // 重新插入到末尾，更新 LRU 位置
  contentCache.delete(key)
  contentCache.set(key, v)
  return v
}

export function cacheSet(key: string, value: CacheEntry): void {
  if (contentCache.has(key)) contentCache.delete(key)
  contentCache.set(key, value)
  if (contentCache.size > CACHE_MAX) {
    const oldestKey = contentCache.keys().next().value
    if (oldestKey !== undefined) contentCache.delete(oldestKey)
  }
}

/** 滚动位置持久化，按会话、路径与预览解析范围隔离。 */
export const scrollPositionCache = new Map<string, { top: number; left: number }>()

export function scrollCacheKey(sessionId: string, filePath: string, scope = ''): string {
  return `${sessionId}:${filePath}:${scope}`
}

/** 获取缓存的滚动位置 */
export function getPreviewScrollPosition(
  sessionId: string,
  filePath: string,
  scope?: string,
): { top: number; left: number } | undefined {
  return scrollPositionCache.get(scrollCacheKey(sessionId, filePath, scope))
}

/**
 * 清除指定 session 的预览缓存，供 useCloseTab / LeftSidebar 调用。
 */
export function clearPreviewCacheForSession(sessionId: string): void {
  const prefix = `${sessionId}:`
  for (const key of scrollPositionCache.keys()) {
    if (key.startsWith(prefix)) scrollPositionCache.delete(key)
  }
  for (const key of contentCache.keys()) {
    if (key.startsWith(prefix)) contentCache.delete(key)
  }
  clearMarkdownEditorStateForSession(sessionId)
}
