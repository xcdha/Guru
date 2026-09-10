import type { KanbanProject } from '@/components/app-shell/kanban/types'
import { filterPickableKanbanProjects } from '@/components/app-shell/kanban/types'

/** UI 默认档：工作区连接器 + 当前工作区 Skills overlay。 */
export type PluginScope =
  | { kind: 'workspace' }
  | {
      kind: 'project'
      projectId: string
      projectName: string
      hasOwnSkills: boolean
    }

/**
 * 项目作用域标记。
 *
 * MCP 已对齐上游 #2037 为工作区级存储（项目级 MCP 覆盖已移除），故仅保留 Skills 维度。
 */
export interface PluginScopeFlags {
  hasOwnSkills: boolean
}

export interface PluginScopeOption {
  id: string
  label: string
  description: string
  scope: PluginScope
}

const WORKSPACE_DESCRIPTION = '连接器按工作区保存；Skills 为当前工作区叠加全局。'

function flagsOf(flags: Record<string, PluginScopeFlags> | undefined, projectId: string): PluginScopeFlags {
  return flags?.[projectId] ?? { hasOwnSkills: false }
}

function describeProjectFlags(flags: PluginScopeFlags): string {
  if (flags.hasOwnSkills) return '含项目级 Skills'
  return 'Skills 叠加工作区/全局'
}

export function buildPluginScopeOptions(input: {
  projects: KanbanProject[]
  flags?: Record<string, PluginScopeFlags>
}): PluginScopeOption[] {
  const options: PluginScopeOption[] = [
    {
      id: 'workspace',
      label: '默认配置',
      description: WORKSPACE_DESCRIPTION,
      scope: { kind: 'workspace' },
    },
  ]

  for (const project of filterPickableKanbanProjects(input.projects)) {
    const flags = flagsOf(input.flags, project.id)
    options.push({
      id: `project:${project.id}`,
      label: project.name,
      description: describeProjectFlags(flags),
      scope: {
        kind: 'project',
        projectId: project.id,
        projectName: project.name,
        hasOwnSkills: flags.hasOwnSkills,
      },
    })
  }

  return options
}

export function describePluginScope(scope: PluginScope): string {
  switch (scope.kind) {
    case 'workspace':
      return `正在查看默认配置。${WORKSPACE_DESCRIPTION}`
    case 'project':
      return `正在查看项目「${scope.projectName}」。${describeProjectFlags(scope)}`
    default: {
      const _exhaustive: never = scope
      return _exhaustive
    }
  }
}

/** 内容区 notice：连接器 / Skills 两维分开说，禁止「沿用 Workspace 默认」那种混写。 */
export function describePluginScopeNotice(scope: PluginScope): string | null {
  switch (scope.kind) {
    case 'workspace':
      return null
    case 'project': {
      const skillsLine = scope.hasOwnSkills
        ? '含项目级 Skills'
        : 'Skills 叠加工作区/全局'
      return `项目「${scope.projectName}」：${skillsLine}；连接器按工作区保存（与项目无关）`
    }
    default: {
      const _exhaustive: never = scope
      return _exhaustive
    }
  }
}

/** 项目从可选项消失时回到默认档（工作区切换后 atom 已按当前 slug 过滤，不再比对 workspaceId）。 */
export function resolvePluginScope(scope: PluginScope, projects: readonly KanbanProject[]): PluginScope {
  switch (scope.kind) {
    case 'workspace':
      return scope
    case 'project': {
      const stillPickable = filterPickableKanbanProjects(projects).some((project) => project.id === scope.projectId)
      return stillPickable ? scope : { kind: 'workspace' }
    }
    default: {
      const _exhaustive: never = scope
      return _exhaustive
    }
  }
}

export function applyPluginScopeFlags(
  scope: PluginScope,
  flags: Record<string, PluginScopeFlags> | undefined,
): PluginScope {
  switch (scope.kind) {
    case 'workspace':
      return scope
    case 'project': {
      const next = flagsOf(flags, scope.projectId)
      if (next.hasOwnSkills === scope.hasOwnSkills) return scope
      return {
        kind: 'project',
        projectId: scope.projectId,
        projectName: scope.projectName,
        hasOwnSkills: next.hasOwnSkills,
      }
    }
    default: {
      const _exhaustive: never = scope
      return _exhaustive
    }
  }
}

/** 用当前可选项同步 scope：项目消失则回默认档，flags 以 option.scope 为准。 */
export function syncPluginScope(scope: PluginScope, options: readonly PluginScopeOption[]): PluginScope {
  switch (scope.kind) {
    case 'workspace':
      return scope
    case 'project': {
      const match = options.find((option) => option.scope.kind === 'project' && option.scope.projectId === scope.projectId)
      return match?.scope.kind === 'project' ? match.scope : { kind: 'workspace' }
    }
    default: {
      const _exhaustive: never = scope
      return _exhaustive
    }
  }
}
