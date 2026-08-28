import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  canonicalizeProjectPath,
  hasRootProjectAgentsInstruction,
  normalizeProjectPathForComparison,
  resolveProjectInstructions,
} from './project-instruction-resolver'

const temporaryProjects: string[] = []

function createProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), 'guru-project-instructions-'))
  temporaryProjects.push(projectRoot)
  return projectRoot
}

afterEach(() => {
  for (const projectRoot of temporaryProjects.splice(0)) {
    rmSync(projectRoot, { recursive: true, force: true })
  }
})

describe('项目根 AGENTS 指令状态（移植自 Proma b0fe28b5）', () => {
  test('Given 大小写不同的 AGENTS.MD When 解析项目指令 Then 标记项目地图已建立', () => {
    const projectRoot = createProject()
    writeFileSync(join(projectRoot, 'AGENTS.MD'), '# Project instructions')

    const manifest = resolveProjectInstructions({ projectRoot })

    expect(manifest.sources).toHaveLength(1)
    expect(manifest.sources[0]).toMatchObject({ kind: 'agents', scopeRoot: '.' })
    expect(hasRootProjectAgentsInstruction(manifest)).toBe(true)
  })

  test('Given 项目内 AGENTS.md 符号链接 When 解析项目指令 Then 标记项目地图已建立', () => {
    const projectRoot = createProject()
    const instructionsDirectory = join(projectRoot, 'instructions')
    mkdirSync(instructionsDirectory)
    writeFileSync(join(instructionsDirectory, 'project.md'), '# Project instructions')
    try {
      symlinkSync(join('instructions', 'project.md'), join(projectRoot, 'AGENTS.md'))
    } catch {
      // Windows 无管理员权限时 symlink 可能失败，跳过符号链接场景
      return
    }

    const manifest = resolveProjectInstructions({ projectRoot })

    expect(manifest.sources).toHaveLength(1)
    expect(hasRootProjectAgentsInstruction(manifest)).toBe(true)
  })

  test('Given 无 AGENTS 指令 When 解析项目指令 Then 未标记项目地图', () => {
    const projectRoot = createProject()
    writeFileSync(join(projectRoot, 'CLAUDE.md'), '# Legacy')

    const manifest = resolveProjectInstructions({ projectRoot })

    expect(hasRootProjectAgentsInstruction(manifest)).toBe(false)
  })
})

describe('路径规范化函数', () => {
  test('canonicalizeProjectPath 对不存在路径逐级向上解析', () => {
    const projectRoot = createProject()
    const missing = join(projectRoot, 'a', 'b', 'c.txt')
    const canonical = canonicalizeProjectPath(missing)
    // 已存在部分（projectRoot）应被 realpath 规范化
    expect(canonical.endsWith(join('a', 'b', 'c.txt'))).toBe(true)
  })

  test('normalizeProjectPathForComparison 在 Windows 上大小写不敏感', () => {
    const projectRoot = createProject()
    const upper = join(projectRoot, 'AGENTS.MD')
    const lower = join(projectRoot, 'agents.md')
    if (process.platform === 'win32') {
      expect(normalizeProjectPathForComparison(upper)).toBe(normalizeProjectPathForComparison(lower))
    } else {
      expect(normalizeProjectPathForComparison(upper)).not.toBe(normalizeProjectPathForComparison(lower))
    }
  })
})
