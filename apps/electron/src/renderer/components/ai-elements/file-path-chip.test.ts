/**
 * resolveFilePathEntry — 文件中转解析的并发去重与缓存
 *
 * 正文里同一路径常在多个 Chip 中重复出现（流式输出尤其密集）。若每个 Chip 各自发一次
 * resolveFilePath IPC，会出现同一路径的重复请求。这里锁住「同键并发只发一次」的契约，
 * 防止该优化被无声移除。
 */

import { describe, expect, test } from 'bun:test'
import { resolveFilePathEntry } from './file-path-chip'

function stubWindow(resolveFilePath: (filePath: string) => Promise<{ resolvedPath?: string } | null>): () => void {
  const originalWindow = globalThis.window
  ;(globalThis as unknown as { window: unknown }).window = { electronAPI: { resolveFilePath } }
  return () => {
    ;(globalThis as unknown as { window: unknown }).window = originalWindow
  }
}

describe('resolveFilePathEntry', () => {
  test('并发同键只发一次 IPC，并命中缓存', async () => {
    let calls = 0
    const restore = stubWindow(async (filePath) => {
      calls += 1
      return { resolvedPath: `/resolved${filePath}` }
    })

    try {
      const [first, second] = await Promise.all([
        resolveFilePathEntry('/notes/a.md', [], 'session-1'),
        resolveFilePathEntry('/notes/a.md', [], 'session-1'),
      ])

      expect(calls).toBe(1)
      expect(first.exists).toBe(true)
      expect(second.resolvedPath).toBe('/resolved/notes/a.md')

      // 已有缓存：不再发起 IPC
      const third = await resolveFilePathEntry('/notes/a.md', [], 'session-1')
      expect(calls).toBe(1)
      expect(third.exists).toBe(true)
    } finally {
      restore()
    }
  })

  test('会话上下文不同视为不同缓存键', async () => {
    let calls = 0
    const restore = stubWindow(async () => {
      calls += 1
      return { resolvedPath: '/resolved/shared.md' }
    })

    try {
      await resolveFilePathEntry('/shared.md', [], 'session-2')
      await resolveFilePathEntry('/shared.md', [], 'session-3')
      expect(calls).toBe(2)
    } finally {
      restore()
    }
  })

  test('解析返回 null 记为文件不存在', async () => {
    const restore = stubWindow(async () => null)

    try {
      const entry = await resolveFilePathEntry('/missing/b.md', [], 'session-4')
      expect(entry.exists).toBe(false)
      expect(entry.resolvedPath).toBeUndefined()
    } finally {
      restore()
    }
  })
})
