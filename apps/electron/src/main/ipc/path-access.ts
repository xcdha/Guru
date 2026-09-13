/**
 * path-access — Agent / 工作区文件访问的路径授权与真实路径解析
 *
 * 从 `src/main/ipc.ts` 抽出（2026-09-13 文件拆分）。原文件 7531 行，这些函数
 * 被多个 handler 分组共用（文件读写、附件、终端、预览等），抽成独立模块后
 * 既减小 ipc.ts，也让后续继续抽取其它 handler 分组时可以直接 import，
 * 不必逐个注入依赖。
 *
 * 职责：
 * - 授权根目录解析（工作区目录、附加目录、skills、候选基础路径）
 * - 真实路径解析（realpath / symlink 处理）与越界校验（isUnderRoot / isPathAllowed）
 * - 路径允许校验（ensurePathAllowed / ensurePathAllowedWithWorktree）
 *
 * 注意与 `../lib/file-access-policy` 区分：那个模块管「访问策略配置」，
 * 本模块管「给定策略下的具体路径授权判定」。
 */

import { existsSync, realpathSync, statSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { normalizePathForCompare, type FileAccessOptions } from '@guru/shared'
import { getAgentSessionMeta } from '../lib/agent-session-manager'
import {
  getAgentWorkspace,
  getWorkspaceAttachedDirectories,
  getWorkspaceAttachedFiles,
  getWorktreeRepos,
  listAgentWorkspaces,
} from '../lib/agent-workspace-manager'
import {
  getAgentWorkspacePath,
  getAgentWorkspacesDir,
  getWorkspaceFilesDir,
  getWorkspaceSkillsDir,
} from '../lib/config-paths'
import { getMainRepoRoot } from '../lib/git-diff-service'
import { projectRepository } from '../lib/project-repository'

export function realpathOrResolve(path: string): string {
  try {
    return realpathSync(resolve(path))
  } catch {
    return resolve(path)
  }
}

export function getAuthorizedRoots(options?: FileAccessOptions): string[] {
  const hasSessionContext = !!(options?.sessionId || options?.workspaceSlug)
  const roots: string[] = [
    // 无会话上下文时保留全局根供文件面板浏览；有会话时只按具体工作区授权。
    ...(hasSessionContext ? [] : [getAgentWorkspacesDir()]),
    join(tmpdir(), 'guru-preview'),
  ]

  const workspaceSlugs = new Set<string>()

  if (options?.sessionId) {
    const meta = getAgentSessionMeta(options.sessionId)
    if (meta?.attachedDirectories) {
      roots.push(...meta.attachedDirectories)
    }
    if (meta?.activeWorktree?.path) {
      roots.push(meta.activeWorktree.path)
    }
    if (meta?.attachedFiles) {
      roots.push(...meta.attachedFiles)
    }
    // 会话已绑定 Git 上下文时，其自身 repo/worktree 路径始终授权——即便下面的 Project
    // 查找因项目被删除/改名等原因失败，已建立的 Git 上下文也不应该突然失去访问权限。
    if (meta?.gitRepoPath) roots.push(meta.gitRepoPath)
    if (meta?.gitWorktreePath) roots.push(meta.gitWorktreePath)
    // 会话已显式解析/绑定的工作目录也要授权；未绑定 Project 或 Git 上下文的
    // 任务会话仍可能以 workingDirectory 作为 SidePanel / Diff / 文件打开的根。
    if (meta?.workingDirectory) roots.push(meta.workingDirectory)
    if (meta?.workspaceId) {
      const workspace = getAgentWorkspace(meta.workspaceId)
      if (workspace?.slug) {
        workspaceSlugs.add(workspace.slug)
        // 有会话归属时，当前工作区的 agent-workspaces/{slug}/ 也是合法根。
        roots.push(getAgentWorkspacePath(workspace.slug))
        // 工作区的工程目录（projectRootPath）也要授权：右侧栏「项目文件」根与
        // 执行 cwd 就是它（workspace-root source），不授权会导致列表/打开/删除全被拒。
        if (workspace.projectRootPath) roots.push(workspace.projectRootPath)
      }
      // 会话绑定的 Project（Git 项目）工作目录也要授权，否则新会话选择 Git 分支/创建
      // Worktree 时，ensurePathAllowedWithWorktree 永远无法通过校验——这里之前完全没有
      // 打通 sessionMeta.projectId → project.config.workingDirectory 这条链路，是
      // Git 分支列表/创建 Worktree 从未真正工作过的根因。
      if (workspace?.slug && meta.projectId) {
        try {
          const project = projectRepository.getProjectAtRoot(getAgentWorkspacePath(workspace.slug), meta.projectId)
          if (project?.config.workingDirectory) roots.push(project.config.workingDirectory)
        } catch {
          // 查找失败不应阻断其他授权路径
        }
      }
    }
  }

  if (options?.workspaceSlug) {
    workspaceSlugs.add(options.workspaceSlug)
  }

  for (const slug of workspaceSlugs) {
    roots.push(getWorkspaceFilesDir(slug))
    roots.push(...getWorkspaceAttachedDirectories(slug))
    roots.push(...getWorkspaceAttachedFiles(slug))
  }

  return roots
}

export function isUnderRoot(resolvedPath: string, root: string): boolean {
  const resolvedRoot = realpathOrResolve(root)
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot + sep)
}

export function isPathAllowed(filePath: string, options?: FileAccessOptions): boolean {
  let resolved: string
  try {
    resolved = realpathSync(resolve(filePath))
  } catch {
    return false
  }
  return getAuthorizedRoots(options).some((root) => isUnderRoot(resolved, root))
}

export async function getResolvedAuthorizedRoots(options?: FileAccessOptions): Promise<string[]> {
  const roots = getAuthorizedRoots(options)
  return Promise.all(roots.map(async (root) => {
    try {
      return await realpath(resolve(root))
    } catch {
      return resolve(root)
    }
  }))
}

export function isResolvedPathAllowed(resolvedPath: string, resolvedRoots: readonly string[]): boolean {
  return resolvedRoots.some((root) => {
    const relativePath = relative(root, resolvedPath)
    return relativePath === '' || (
      relativePath !== '..'
      && !relativePath.startsWith(`..${sep}`)
      && !isAbsolute(relativePath)
    )
  })
}

export function getWorkspaceSlugsForAccess(options?: FileAccessOptions): string[] {
  const workspaceSlugs = new Set<string>()
  if (options?.sessionId) {
    const meta = getAgentSessionMeta(options.sessionId)
    if (meta?.workspaceId) {
      const workspace = getAgentWorkspace(meta.workspaceId)
      if (workspace?.slug) workspaceSlugs.add(workspace.slug)
    }
  }
  if (options?.workspaceSlug) {
    workspaceSlugs.add(options.workspaceSlug)
  }
  return Array.from(workspaceSlugs)
}

export function getManagedSkillBasePath(options?: FileAccessOptions): string | undefined {
  const workspaceSlug = options?.workspaceSkillSlug
  if (!workspaceSlug || !getWorkspaceSlugsForAccess(options).includes(workspaceSlug)) return undefined
  const workspace = listAgentWorkspaces().find((item) => item.slug === workspaceSlug)
  return workspace ? getWorkspaceSkillsDir(workspace.slug) : undefined
}

export function getAllowedCandidateBasePaths(options?: FileAccessOptions): string[] | undefined {
  const allowed = (getPreviewCandidateBasePaths(options) ?? []).filter((p) => isPathAllowed(p, options))
  return allowed.length > 0 ? allowed : undefined
}

export function getLegacySkillBasePath(options?: FileAccessOptions): string | undefined {
  const legacyFilePath = options?.legacySkillFilePath
  if (!legacyFilePath) return undefined
  const normalized = legacyFilePath.replace(/\\/g, '/')
  return normalized.match(/^(.*\/skills)\/[^/]+\/SKILL\.md$/i)?.[1]
}

export function getPreviewCandidateBasePaths(options?: FileAccessOptions): string[] | undefined {
  const bases = options?.candidateBasePaths?.filter((p) => typeof p === 'string' && p.length > 0) ?? []
  const managedSkillBasePath = getManagedSkillBasePath(options)
  if (managedSkillBasePath && !bases.includes(managedSkillBasePath)) {
    bases.unshift(managedSkillBasePath)
  }
  const legacySkillBasePath = getLegacySkillBasePath(options)
  if (legacySkillBasePath && !bases.includes(legacySkillBasePath)) {
    bases.push(legacySkillBasePath)
  }
  return bases.length > 0 ? bases : undefined
}

/** Resolve preview-only relative paths before handing them to OS-level file actions. */
export async function resolveFileAccessPath(filePath: string, options?: FileAccessOptions): Promise<string> {
  const [{ resolve }, { resolveFilePath }] = await Promise.all([
    import('node:path'),
    import('../lib/file-preview-service'),
  ])
  return resolveFilePath(filePath, getPreviewCandidateBasePaths(options)) ?? resolve(filePath)
}

export async function getAccessRootMainRepo(root: string): Promise<string | null> {
  if (!existsSync(root)) return null
  let probePath = root
  try {
    const stats = statSync(probePath)
    if (stats.isFile()) probePath = dirname(probePath)
  } catch {
    return null
  }
  return getMainRepoRoot(probePath)
}

export function ensurePathAllowed(filePath: string, options?: FileAccessOptions): boolean {
  if (isPathAllowed(filePath, options)) return true
  console.warn('[IPC] 拒绝越界路径:', filePath)
  return false
}

/**
 * 在 ensurePathAllowed 基础上，额外放行「已授权仓库的 worktree」。
 *
 * worktree 常被放在主仓库之外（如 ~/guru-dev/worktrees/xxx），其路径不在任何
 * 授权根下，会被 ensurePathAllowed 拒绝。但只要它回溯到的主仓库已被授权，就应放行。
 * 用 git 自身背书（--git-common-dir），避免粗暴跳过安全检查。
 */
export async function ensurePathAllowedWithWorktree(filePath: string, options?: FileAccessOptions): Promise<boolean> {
  if (isPathAllowed(filePath, options)) return true
  const mainRepo = await getMainRepoRoot(filePath)
  if (mainRepo && isPathAllowed(mainRepo, options)) return true
  if (mainRepo) {
    const targetMainRepo = normalizePathForCompare(realpathOrResolve(mainRepo))
    for (const root of getAuthorizedRoots(options)) {
      const authorizedMainRepo = await getAccessRootMainRepo(root)
      if (!authorizedMainRepo) continue
      const authorizedRoot = normalizePathForCompare(realpathOrResolve(authorizedMainRepo))
      if (authorizedRoot === targetMainRepo) return true
    }
    for (const workspaceSlug of getWorkspaceSlugsForAccess(options)) {
      let repos: import('@guru/shared').WorkspaceWorktreeRepo[]
      try {
        repos = await getWorktreeRepos(workspaceSlug)
      } catch {
        continue
      }
      for (const repo of repos) {
        const repoMain = await getMainRepoRoot(repo.repoPath)
        const repoRoot = normalizePathForCompare(realpathOrResolve(repoMain ?? repo.repoPath))
        if (repoRoot === targetMainRepo) return true
      }
    }
  }
  console.warn('[IPC] 拒绝越界路径:', filePath)
  return false
}
