import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isSessionPlanMarkdownPath } from './agent-plan-file-policy'

describe('isSessionPlanMarkdownPath', () => {
  test('允许计划目录内既有的 Markdown 文件与待创建的新文件', () => {
    const planDirectory = mkdtempSync(join(tmpdir(), 'guru-plan-policy-'))
    try {
      const existing = join(planDirectory, 'plan.md')
      writeFileSync(existing, '# 计划')
      expect(isSessionPlanMarkdownPath(existing, planDirectory)).toBe(true)
      expect(isSessionPlanMarkdownPath(join(planDirectory, 'new-plan.md'), planDirectory)).toBe(true)
      // 父目录不存在时不允许隐式创建多层目录
      expect(isSessionPlanMarkdownPath(join(planDirectory, 'nested', 'deep.md'), planDirectory)).toBe(false)
      mkdirSync(join(planDirectory, 'nested'))
      expect(isSessionPlanMarkdownPath(join(planDirectory, 'nested', 'deep.md'), planDirectory)).toBe(true)
    } finally {
      rmSync(planDirectory, { recursive: true, force: true })
    }
  })

  test('拒绝相对路径、非 Markdown 扩展名、目录外路径与缺失的计划目录', () => {
    const planDirectory = mkdtempSync(join(tmpdir(), 'guru-plan-policy-'))
    try {
      expect(isSessionPlanMarkdownPath('.context/plan/plan.md', planDirectory)).toBe(false)
      expect(isSessionPlanMarkdownPath(join(planDirectory, 'notes.txt'), planDirectory)).toBe(false)
      expect(isSessionPlanMarkdownPath(join(planDirectory, '..', 'escape.md'), planDirectory)).toBe(false)
      expect(isSessionPlanMarkdownPath(join(planDirectory, 'plan.md'), undefined)).toBe(false)
      expect(isSessionPlanMarkdownPath(join(planDirectory, 'plan.md'), join(planDirectory, 'missing-plan'))).toBe(false)
    } finally {
      rmSync(planDirectory, { recursive: true, force: true })
    }
  })

  test('拒绝指向计划目录外的符号链接文件（平台不支持创建符号链接时跳过）', () => {
    const planDirectory = mkdtempSync(join(tmpdir(), 'guru-plan-policy-'))
    const outsideDirectory = mkdtempSync(join(tmpdir(), 'guru-plan-policy-outside-'))
    try {
      const outsideFile = join(outsideDirectory, 'target.md')
      writeFileSync(outsideFile, '# 目标')
      const linkPath = join(planDirectory, 'link.md')
      try {
        symlinkSync(outsideFile, linkPath)
      } catch {
        return
      }
      expect(isSessionPlanMarkdownPath(linkPath, planDirectory)).toBe(false)
    } finally {
      rmSync(planDirectory, { recursive: true, force: true })
      rmSync(outsideDirectory, { recursive: true, force: true })
    }
  })
})
