import { describe, expect, test } from 'bun:test'
import type { KanbanProject } from '@/components/app-shell/kanban/types'
import {
  applyPluginScopeFlags,
  buildPluginScopeOptions,
  describePluginScope,
  describePluginScopeNotice,
  resolvePluginScope,
  syncPluginScope,
  type PluginScope,
  type PluginScopeFlags,
} from './plugin-scope-model'

function project(
  id: string,
  name: string,
  extras: Partial<KanbanProject> = {},
): KanbanProject {
  return { id, name, ...extras }
}

const projects: KanbanProject[] = [
  project('p1', 'App', { workspaceId: 'ws-a' }),
  project('p2', 'Hidden', { workspaceId: 'ws-a', kind: 'home' }),
  project('p3', 'Other', { workspaceId: 'ws-b' }),
  project('p4', 'Scratch', { kind: 'ad-hoc' }),
  project('p5', 'NoWorkspaceId'),
]

describe('plugin-scope-model', () => {
  test('builds default config plus pickable projects, ignoring workspaceId', () => {
    const options = buildPluginScopeOptions({ projects })
    expect(options.map((option) => option.id)).toEqual([
      'workspace',
      'project:p1',
      'project:p3',
      'project:p5',
    ])
    expect(options[0]?.label).toBe('默认配置')
    expect(options[0]?.label).not.toContain('全部项目共享')
    expect(options[0]?.description).toContain('连接器按工作区保存')
    expect(options[0]?.description).toContain('Skills 为当前工作区叠加全局')
    expect(options.map((option) => option.label)).toEqual([
      '默认配置',
      'App',
      'Other',
      'NoWorkspaceId',
    ])
  })

  test('does not require currentWorkspaceId and keeps projects without workspaceId', () => {
    const mixed = [
      project('local', 'Local'),
      project('foreign', 'Foreign', { workspaceId: 'someone-else' }),
      project('home', 'Home', { kind: 'home' }),
    ]
    const options = buildPluginScopeOptions({ projects: mixed })
    expect(options.map((option) => option.id)).toEqual([
      'workspace',
      'project:local',
      'project:foreign',
    ])
  })

  test('uses no-overlay copy when project flags are missing', () => {
    const [workspace, app] = buildPluginScopeOptions({ projects })
    expect(workspace?.scope).toEqual({ kind: 'workspace' })
    expect(app?.scope).toEqual({
      kind: 'project',
      projectId: 'p1',
      projectName: 'App',
      hasOwnSkills: false,
    })
    expect(app?.description).toBe('Skills 叠加工作区/全局')
  })

  test('describes project skills overlay flags', () => {
    const flags: Record<string, PluginScopeFlags> = {
      p1: { hasOwnSkills: false },
      p3: { hasOwnSkills: true },
    }
    const options = buildPluginScopeOptions({ projects, flags })
    const byId = Object.fromEntries(options.map((option) => [option.id, option]))

    expect(byId['project:p1']?.description).toBe('Skills 叠加工作区/全局')
    expect(byId['project:p3']?.description).toBe('含项目级 Skills')
    expect(byId['project:p3']?.scope).toMatchObject({ hasOwnSkills: true })
  })

  test('describePluginScope matches option semantics', () => {
    expect(describePluginScope({ kind: 'workspace' })).toContain('连接器按工作区保存')
    expect(describePluginScope({ kind: 'workspace' })).toContain('Skills 为当前工作区叠加全局')
    expect(describePluginScope({ kind: 'workspace' })).not.toContain('全部项目共享')
    expect(describePluginScope({ kind: 'workspace' })).not.toContain('Workspace 默认')

    const noOverlay: PluginScope = {
      kind: 'project',
      projectId: 'p1',
      projectName: 'App',
      hasOwnSkills: false,
    }
    expect(describePluginScope(noOverlay)).toContain('App')
    expect(describePluginScope(noOverlay)).toContain('Skills 叠加工作区/全局')
    expect(describePluginScope(noOverlay)).not.toContain('沿用 Workspace 默认')

    expect(describePluginScope({
      kind: 'project',
      projectId: 'p1',
      projectName: 'App',
      hasOwnSkills: true,
    })).toContain('含项目级 Skills')
  })

  test('project notice splits MCP (workspace-scoped) and Skills overlays', () => {
    const notice = describePluginScopeNotice({
      kind: 'project',
      projectId: 'p1',
      projectName: 'App',
      hasOwnSkills: false,
    })
    expect(notice).toContain('App')
    expect(notice).toContain('Skills 叠加工作区/全局')
    expect(notice).toContain('连接器按工作区保存')
    expect(notice).not.toContain('未配置的技能或连接器会沿用 Workspace 默认')
    expect(notice).not.toContain('Workspace 默认')

    expect(describePluginScopeNotice({
      kind: 'project',
      projectId: 'p1',
      projectName: 'App',
      hasOwnSkills: true,
    })).toContain('含项目级 Skills')

    expect(describePluginScopeNotice({ kind: 'workspace' })).toBeNull()
  })

  test('resolvePluginScope resets when the project is no longer pickable', () => {
    const current: PluginScope = {
      kind: 'project',
      projectId: 'p1',
      projectName: 'App',
      hasOwnSkills: false,
    }
    expect(resolvePluginScope(current, [project('p3', 'Other')])).toEqual({ kind: 'workspace' })
    expect(resolvePluginScope(current, [project('p1', 'App', { kind: 'home' })])).toEqual({ kind: 'workspace' })
    expect(resolvePluginScope(current, [project('p1', 'App', { workspaceId: 'ws-b' })])).toEqual(current)
    expect(resolvePluginScope({ kind: 'workspace' }, [])).toEqual({ kind: 'workspace' })
  })

  test('applyPluginScopeFlags fills missing flags as false', () => {
    const current: PluginScope = {
      kind: 'project',
      projectId: 'p1',
      projectName: 'App',
      hasOwnSkills: true,
    }
    expect(applyPluginScopeFlags(current, { p1: { hasOwnSkills: false } })).toEqual({
      kind: 'project',
      projectId: 'p1',
      projectName: 'App',
      hasOwnSkills: false,
    })
    expect(applyPluginScopeFlags(current, {})).toEqual({
      kind: 'project',
      projectId: 'p1',
      projectName: 'App',
      hasOwnSkills: false,
    })
    expect(applyPluginScopeFlags({ kind: 'workspace' }, { p1: { hasOwnSkills: true } })).toEqual({
      kind: 'workspace',
    })
  })

  test('syncPluginScope follows option flags and resets missing projects', () => {
    const options = buildPluginScopeOptions({
      projects: [project('p1', 'App')],
      flags: { p1: { hasOwnSkills: true } },
    })
    expect(syncPluginScope({
      kind: 'project',
      projectId: 'p1',
      projectName: 'App',
      hasOwnSkills: false,
    }, options)).toEqual({
      kind: 'project',
      projectId: 'p1',
      projectName: 'App',
      hasOwnSkills: true,
    })
    expect(syncPluginScope({
      kind: 'project',
      projectId: 'gone',
      projectName: 'Gone',
      hasOwnSkills: false,
    }, options)).toEqual({ kind: 'workspace' })
  })
})
