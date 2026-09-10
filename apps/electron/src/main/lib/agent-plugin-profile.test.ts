import { describe, expect, test } from 'bun:test'
import { resolveEffectivePluginScope } from './agent-plugin-profile'

describe('resolveEffectivePluginScope', () => {
  test('无 project 时 Skills 自有层走工作区', () => {
    expect(
      resolveEffectivePluginScope({
        workspaceSlug: 'default',
        projectId: undefined,
        hasProjectSkills: false,
      }),
    ).toEqual({
      workspaceSlug: 'default',
      projectId: undefined,
      skillsDirScope: 'workspace',
    })
  })

  test('project 有 Skills overlay 时 Skills 自有层走项目', () => {
    expect(
      resolveEffectivePluginScope({
        workspaceSlug: 'default',
        projectId: 'p1',
        hasProjectSkills: true,
      }),
    ).toEqual({
      workspaceSlug: 'default',
      projectId: 'p1',
      skillsDirScope: 'project',
    })
  })

  test('project 无 Skills overlay 时仍走工作区', () => {
    expect(
      resolveEffectivePluginScope({
        workspaceSlug: 'default',
        projectId: 'p1',
        hasProjectSkills: false,
      }),
    ).toEqual({
      workspaceSlug: 'default',
      projectId: 'p1',
      skillsDirScope: 'workspace',
    })
  })

  test('无 workspaceSlug 时仍按 overlay 布尔算 scope，并原样回传 slug/projectId', () => {
    expect(
      resolveEffectivePluginScope({
        workspaceSlug: undefined,
        projectId: 'p1',
        hasProjectSkills: true,
      }),
    ).toEqual({
      workspaceSlug: undefined,
      projectId: 'p1',
      skillsDirScope: 'project',
    })
  })

  test('无 projectId 时即使 overlay 布尔为 true 也不升到 project', () => {
    expect(
      resolveEffectivePluginScope({
        workspaceSlug: 'default',
        projectId: undefined,
        hasProjectSkills: true,
      }),
    ).toEqual({
      workspaceSlug: 'default',
      projectId: undefined,
      skillsDirScope: 'workspace',
    })
  })
})
