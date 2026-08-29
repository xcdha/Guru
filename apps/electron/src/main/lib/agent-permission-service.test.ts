import { describe, expect, test } from 'bun:test'
import { AgentPermissionService, type CanUseToolOptions } from './agent-permission-service'

function permissionOptions(signal: AbortSignal, toolUseID: string): CanUseToolOptions {
  return { signal, toolUseID, displayName: '删除分组', description: '删除 Todo 分组' }
}

describe('AgentPermissionService 生命周期', () => {
  test('clearAllPending 会拒绝并释放所有会话的挂起权限请求', async () => {
    const service = new AgentPermissionService()
    const signal = new AbortController().signal
    const first = service.requestSingleApproval(
      'session-a',
      'Bash',
      { command: 'rm -rf /' },
      { signal, toolUseID: 'tool-a' },
      () => {},
    )
    const second = service.requestSingleApproval(
      'session-b',
      'Write',
      { file_path: '/tmp/x' },
      { signal, toolUseID: 'tool-b' },
      () => {},
    )

    service.clearAllPending()
    await expect(first).resolves.toEqual({ behavior: 'deny', message: '应用正在退出' })
    await expect(second).resolves.toEqual({ behavior: 'deny', message: '应用正在退出' })
    expect(service.getPendingRequests()).toEqual([])
  })
})

test('Given a destructive planning request When it is approved Then approval is single-use and cannot create a session whitelist', async () => {
  const service = new AgentPermissionService()
  const controller = new AbortController()
  let firstRequest: { requestId: string; allowAlways?: boolean } | undefined

  const firstResult = service.requestSingleApproval(
    'session-1',
    'mcp__planning__delete_group',
    { id: 'group-1', scope: 'todo' },
    permissionOptions(controller.signal, 'tool-1'),
    (request) => { firstRequest = request },
  )

  expect(firstRequest?.allowAlways).toBe(false)
  expect(service.respondToPermission(firstRequest!.requestId, 'allow', true)).toBe('session-1')
  expect((await firstResult).behavior).toBe('allow')

  let secondRequest: { requestId: string } | undefined
  const secondResult = service.createCanUseTool('session-1', (request) => { secondRequest = request })(
    'mcp__planning__delete_group',
    { id: 'group-2', scope: 'todo' },
    permissionOptions(controller.signal, 'tool-2'),
  )

  expect(secondRequest).toBeDefined()
  expect(service.respondToPermission(secondRequest!.requestId, 'deny', false)).toBe('session-1')
  expect((await secondResult).behavior).toBe('deny')
})
