import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('IPC file access roots', () => {
  test('session workingDirectory is part of authorized roots even without project or git context', () => {
    // 2026-09-13：授权根目录解析已从 ipc.ts 抽到 ipc/path-access.ts（文件拆分），
    // 本守卫测试改为断言新位置，语义不变。
    const source = readFileSync(join(__dirname, '../ipc/path-access.ts'), 'utf-8')
    expect(source).toContain('meta?.workingDirectory')
    expect(source).toContain('roots.push(meta.workingDirectory)')
  })
})
