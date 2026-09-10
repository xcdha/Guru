import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentExitPlanService } from './agent-exit-plan-service'

describe('AgentExitPlanService 生命周期', () => {
  test('clearAllPending 会拒绝并释放所有会话的挂起计划审批', async () => {
    // 计划审批现在要求合法的 planFile：先构造真实计划目录与计划文件，确保请求进入挂起队列。
    const planDirectory = mkdtempSync(join(tmpdir(), 'guru-plan-test-'))
    const planFile = join(planDirectory, 'my-plan.md')
    writeFileSync(planFile, '# 测试计划')

    try {
      const service = new AgentExitPlanService()
      const signal = new AbortController().signal
      const first = service.handleExitPlanMode('session-a', { planFile }, signal, () => {}, { planDirectory })
      const second = service.handleExitPlanMode('session-b', { planFile }, signal, () => {}, { planDirectory })

      service.clearAllPending()

      await expect(first).resolves.toEqual({ behavior: 'deny', message: '应用正在退出' })
      await expect(second).resolves.toEqual({ behavior: 'deny', message: '应用正在退出' })
      expect(service.getPendingRequests()).toEqual([])
    } finally {
      rmSync(planDirectory, { recursive: true, force: true })
    }
  })

  test('缺少有效 planFile 时直接拒绝，不进入挂起队列', async () => {
    const service = new AgentExitPlanService()
    const result = await service.handleExitPlanMode('session-c', {}, new AbortController().signal, () => {})
    expect(result.behavior).toBe('deny')
    expect(service.getPendingRequests()).toEqual([])
  })

  test('计划目录之外的 Markdown 文件不被接受为计划文档', async () => {
    const planDirectory = mkdtempSync(join(tmpdir(), 'guru-plan-test-'))
    const outsideDirectory = mkdtempSync(join(tmpdir(), 'guru-plan-outside-'))
    const outsideFile = join(outsideDirectory, 'escape.md')
    writeFileSync(outsideFile, '# 目录外文件')

    try {
      const service = new AgentExitPlanService()
      const result = await service.handleExitPlanMode(
        'session-d',
        { planFile: outsideFile },
        new AbortController().signal,
        () => {},
        { planDirectory },
      )
      expect(result.behavior).toBe('deny')
      expect(service.getPendingRequests()).toEqual([])
    } finally {
      rmSync(planDirectory, { recursive: true, force: true })
      rmSync(outsideDirectory, { recursive: true, force: true })
    }
  })
})
