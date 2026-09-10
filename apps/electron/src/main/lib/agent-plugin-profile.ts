export interface EffectivePluginScopeInput {
  workspaceSlug: string | undefined
  projectId: string | undefined
  hasProjectSkills: boolean
}

export interface EffectivePluginScope {
  workspaceSlug: string | undefined
  projectId: string | undefined
  skillsDirScope: 'workspace' | 'project'
}

/**
 * 解析会话运行时 Skills 自有层该读哪一层。
 *
 * MCP 已对齐上游 #2037 为工作区级存储（项目级 MCP 覆盖已移除），故本函数不再判定 mcpScope。
 *
 * - Skills 自有层目录（标注用）：项目有自己的 skills 才用项目目录，否则工作区目录
 */
export function resolveEffectivePluginScope(input: EffectivePluginScopeInput): EffectivePluginScope {
  return {
    workspaceSlug: input.workspaceSlug,
    projectId: input.projectId,
    skillsDirScope: input.projectId && input.hasProjectSkills ? 'project' : 'workspace',
  }
}
