/**
 * IPC 处理器模块
 *
 * 负责注册主进程和渲染进程之间的通信处理器
 */

import { ipcMain, nativeTheme, shell, dialog, BrowserWindow, app, clipboard, nativeImage } from 'electron'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { IPC_CHANNELS, CHANNEL_IPC_CHANNELS, CHAT_IPC_CHANNELS, AGENT_IPC_CHANNELS, ENVIRONMENT_IPC_CHANNELS, INSTALLER_IPC_CHANNELS, PROXY_IPC_CHANNELS, GITHUB_RELEASE_IPC_CHANNELS, SYSTEM_PROMPT_IPC_CHANNELS, CHAT_TOOL_IPC_CHANNELS, FEISHU_IPC_CHANNELS, DINGTALK_IPC_CHANNELS, WECHAT_IPC_CHANNELS, SLACK_IPC_CHANNELS, AUTOMATION_IPC_CHANNELS, EXPERT_IPC_CHANNELS, AGENT_THINKING_LEVELS, isGuruPermissionMode, normalizePathForCompare, PLANNING_IPC_CHANNELS, RELEASE_NOTES_IPC_CHANNELS, FEEDBACK_IPC_CHANNELS, DISCOVER_IPC_CHANNELS, VAULT_IPC_CHANNELS, type FeedbackGithubConfig, type FeedbackSubmitInput, type PlanningWorkspaceScope, type DiscoverContentItem, type DiscussionCategorySlug, MAX_ATTACHMENT_SIZE } from '@guru/shared'
import { USER_PROFILE_IPC_CHANNELS, SETTINGS_IPC_CHANNELS, SCRATCH_PAD_IPC_CHANNELS, QUICK_TASK_IPC_CHANNELS, VOICE_DICTATION_IPC_CHANNELS, DOCK_BADGE_IPC_CHANNELS, STORAGE_IPC_CHANNELS, USAGE_IPC_CHANNELS } from '../types'
import type {
  QuickTaskSubmitInput,
  VoiceDictationAudioChunkInput,
  VoiceDictationCommitInput,
  VoiceDictationCommitResult,
  VoiceDictationPreviewInput,
  VoiceDictationResizeInput,
  VoiceDictationSettings,
  VoiceDictationSettingsUpdate,
  VoiceDictationStartInput,
  VoiceDictationStopInput,
  VoiceDictationTestResult,
  VoiceDictationTextDeliveryInput,
  VoiceDictationToggleInput,
  MicPermissionResult,
} from '../types'
import type {
  RuntimeStatus,
  GitRepoStatus,
  GitBranchInfo,
  ListGitBranchesInput,
  PrepareSessionGitContextInput,
  PrepareSessionGitContextResult,
  RefreshSessionGitBranchInput,
  RefreshSessionGitBranchResult,
  Channel,
  ChannelCreateInput,
  ChannelUpdateInput,
  ChannelTestResult,
  ChannelDirectTestInput,
  FetchModelsInput,
  FetchModelsResult,
  ConversationMeta,
  ChatMessage,
  ChatSendInput,
  GenerateTitleInput,
  AttachmentSaveInput,
  AttachmentSaveResult,
  FileDialogResult,
  FileOrFolderDialogResult,
  RecentMessagesResult,
  AgentSessionMeta,
  SetAgentSessionActiveWorktreeInput,
  AgentSendInput,
  AgentRuntime,
  AgentThinkingLevel,
  AgentWorkspace,
  AgentGenerateTitleInput,
  AgentSaveFilesInput,
  AgentSaveWorkspaceFilesInput,
  AgentSavedFile,
  AgentAttachDirectoryInput,
  AgentAttachFileInput,
  WorkspaceAttachDirectoryInput,
  WorkspaceAttachFileInput,
  GetTaskOutputInput,
  GetTaskOutputResult,
  StopTaskInput,
  WorkspaceMcpConfig,
  SkillMeta,
  SkillScope,
  BulkImportSkillItemResult,
  BulkImportSkillsResult,
  BulkImportWorkspaceSelection,
  BulkImportProjectSelection,
  OtherProjectSkillsGroup,
  SkillFileContent,
  WorkspaceCapabilities,
  WorkspaceMemorySummary,
  OrganizationConnection,
  OrganizationSkill,
  CommunitySkill,
  CommunitySkillInstallResult,
  FileEntry,
  FileSearchResult,
  EnvironmentCheckResult,
  InstallerManifest,
  InstallerDownloadRequest,
  InstallerDownloadResult,
  ProxyConfig,
  SystemProxyDetectResult,
  GitHubRelease,
  GitHubReleaseListOptions,
  PermissionResponse,
  GuruPermissionMode,
  AskUserResponse,
  ExitPlanModeResponse,
  SystemPromptConfig,
  SystemPrompt,
  SystemPromptCreateInput,
  SystemPromptUpdateInput,
  ChatToolInfo,
  ChatToolState,
  ChatToolMeta,
  MoveSessionToWorkspaceInput,
  ForkSessionInput,
  RewindSessionInput,
  RewindSessionResult,
  AgentSessionReferenceSearchInput,
  FeishuConfigInput,
  FeishuConfig,
  FeishuBridgeState,
  FeishuTestResult,
  FeishuChatBinding,
  FeishuPresenceReport,
  FeishuUpdateBindingInput,
  FeishuRegisterAppQRCode,
  FeishuRegisterAppStatus,
  FeishuRegisterAppResult,
  DingTalkConfigInput,
  DingTalkConfig,
  DingTalkBridgeState,
  DingTalkTestResult,
  WeChatConfig,
  WeChatBridgeState,
  SDKMessage,
  GetFileDiffInput,
  DetachedPreviewWindowInput,
  RevertFileInput,
  FileAccessOptions,
  ResolvedFileUrl,
  Automation,
  CreateAutomationInput,
  UpdateAutomationInput,
  Todo,
  TodoListQuery,
  CalendarEvent,
  CalendarEventListQuery,
  PlanningGroup,
  PlanningGroupScope,
  PlanningTag,
  PlanningReminder,
  ActivePlanningReminder,
  CreateTodoInput,
  UpdateTodoInput,
  StartTodoAgentInput,
  StartTodoAgentResult,
  TodoAgentSessionActivation,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
  CreatePlanningGroupInput,
  UpdatePlanningGroupInput,
  SnoozePlanningReminderInput,
  PlanningNativeSyncEntity,
  PlanningNativeSyncStatus,
  PlanningNativeSyncPermissionResult,
  PlanningNativeSyncTarget,
  PlanningNativeConnection,
  PlanningNativeSyncConflict,
  ConnectPlanningNativeConnectionInput,
  ResolvePlanningNativeSyncConflictInput,
  PlanningSyncProfile,
  SavePlanningSyncProfileInput,
  BrowserViewState,
  BrowserViewLayout,
  BrowserNavigateInput,
  BrowserTabInput,
  BrowserCreateTabInput,
} from '@guru/shared'
import type { ExpertManifest, ExpertPackage } from '@guru/shared/experts'
import type { UserProfile, AppSettings } from '../types'
import { getRuntimeStatus, getGitRepoStatus, reinitializeRuntime } from './lib/runtime-init'
import { browserController } from './lib/browser-controller'
import { agentTerminalController } from './lib/agent-terminal'
import { resolveBrowserProfileKey } from './lib/browser-profile-policy'
import {
  getUnstagedChanges,
  invalidateGitDiffCache,
  getFileDiff,
  getUntrackedContent,
  revertFile,
  getDiffContents,
  listWorktrees,
  getWorktreeChanges,
  getMainRepoRoot,
} from './lib/git-diff-service'
import { listGitBranchesForSession, prepareSessionGitContext, refreshSessionGitBranch } from './lib/git-session-context-service'
import { registerGuruDirectoryPath, registerGuruFilePath } from './lib/local-file-protocol'
import { applyWindowZoomIn, applyWindowZoomOut } from './lib/window-zoom'
import {
  authorizeDiscoveredVault,
  configureVault,
  createUntitledVaultFile,
  createUntitledVaultFileInFolder,
  createVaultFolder,
  discoverObsidianVaultCandidates,
  discoverVaultCandidates,
  selectDefaultVault,
  getConfiguredVaultFileSystem,
  getVaultSummary,
  setVaultUserContext,
  clearVaultUserContext,
} from './lib/vault-service'
import { registerUpdaterIpc } from './lib/updater/updater-ipc'
import {
  listChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  decryptApiKey,
  testChannel,
  testChannelDirect,
  fetchModels,
  getChannelById,
  getChannelPlanQuota,
} from './lib/channel-manager'
import { loginCodexOAuth, cancelCodexOAuthLogin } from './lib/codex-oauth-service'
import { loginGithubCopilotOAuth, cancelGithubCopilotOAuthLogin } from './lib/github-copilot-oauth-service'
import { loginXaiOAuth, cancelXaiOAuthLogin } from './lib/xai-oauth-service'
import { resolvePiReasoningCapability } from './lib/adapters/pi-model-registry'
import { serializeCodexCredentials, serializeClaudeOAuthCredentials, serializeGithubCopilotCredentials, serializeXaiCredentials } from '@guru/shared'
import type { CodexOAuthDeviceCode, CodexOAuthLoginMethod, GithubCopilotOAuthDeviceCode, XaiOAuthDeviceCode } from '@guru/shared'
import { prepareClaudeOAuthLogin, exchangeClaudeOAuthCode, cancelClaudeOAuthLogin } from './lib/claude-oauth-service'
import {
  listConversations,
  createConversation,
  getConversationMessages,
  getRecentMessages,
  updateConversationMeta,
  deleteConversation,
  deleteMessage,
  truncateMessagesFrom,
  updateContextDividers,
  autoArchiveConversations,
  searchConversationMessages,
} from './lib/conversation-manager'
import { sendMessage, stopGeneration, generateTitle } from './lib/chat-service'
import {
  saveAttachment,
  readAttachmentAsBase64,
  deleteAttachment,
  openFileDialog,
  openFileOrFolderDialog,
} from './lib/attachment-service'
import { extractTextFromAttachment } from './lib/document-parser'
import { getTutorialContent, createWelcomeConversation } from './lib/tutorial-service'
import { getUserProfile, updateUserProfile } from './lib/user-profile-service'
import { getSettings, updateSettings, updateSettingsAsync } from './lib/settings-service'
import { applyIconForCurrentTheme } from './lib/icon-applier'
import { refreshCodeClawConfiguration } from './lib/codeclaw-service'
import { setBuiltinMcpUserEnabled } from './lib/builtin-mcp/settings'
import { setDockBadgeCount } from './lib/dock-badge-service'

import { checkEnvironment } from './lib/environment-checker'
import { fetchInstallerManifest, findInstallerSource } from './lib/installer-manifest'
import {
  cancelInstallerDownload,
  downloadInstaller,
  launchInstaller,
} from './lib/installer-downloader'
import { getProxySettings, saveProxySettings } from './lib/proxy-settings-service'
import { detectSystemProxy } from './lib/system-proxy-detector'
import {
  listAutomations,
  getAutomation,
  createAutomation,
  getEffectiveAutomationScheduleFields,
  validateExplicitAutomationScheduleFields,
  updateAutomation,
  deleteAutomation,
} from './lib/automation-manager'
import { runAutomationNow, broadcastChanged as broadcastAutomationsChanged } from './lib/automation-scheduler'
import {
  listTodos,
  getTodo,
  createTodo,
  updateTodo,
  deleteTodo,
  touchTodoSession,
  listCalendarEvents,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  listPlanningGroups,
  createPlanningGroup,
  updatePlanningGroup,
  deletePlanningGroup,
  listPlanningTags,
  listActivePlanningReminders,
  acknowledgePlanningReminder,
  snoozePlanningReminder,
  listPlanningSyncProfiles,
  listPlanningNativeConnections,
  connectPlanningNativeConnection,
  disconnectPlanningNativeConnection,
  listPlanningNativeSyncConflicts,
  resolvePlanningNativeSyncConflict,
  savePlanningSyncProfile,
} from './lib/planning-manager'
import { broadcastPlanningChanged } from './lib/planning-events'
import {
  getPlanningNativeSyncStatus,
  listPlanningNativeSyncTargets,
  listPlanningNativeConnectionTargets,
  requestPlanningNativeSyncAccess,
} from './lib/planning-native-sync-service'
import { runPlanningNativeSync } from './lib/planning-native-sync-coordinator'
import {
  createExpert,
  createTeam,
  getExpert,
  getTeam,
  listExperts,
  listTeams,
  updateExpertFiles,
  updateExpertManifest,
  updateTeam,
  type CreateTeamInput,
  type UpdateTeamInput,
} from './lib/expert-service'
import type { TeamSquad, ExpertTemplate } from '@guru/shared/experts'
import {
  listAgentSessions,
  createAgentSession,
  getAgentSessionMeta,
  getAgentSessionSDKMessages,
  updateAgentSessionMeta,
  deleteAgentSession,
  assertAgentSessionDeletionSafe,
  migrateChatToAgentSession,
  moveSessionToWorkspace,
  forkAgentSession,
  autoArchiveAgentSessions,
  cleanupStaleAttachedPaths,
  searchAgentSessionMessages,
  searchAgentSessionReferences,
} from './lib/agent-session-manager'
import { runAgent, stopAgent, generateAgentTitle, saveFilesToAgentSession, saveFilesToWorkspaceFiles, isAgentSessionActive, isAgentSessionBusy, reserveAgentSessionStart, queueAgentMessage, enqueueAgentQueuedMessage, cancelAgentQueuedMessage, moveAgentQueuedMessage, clearAgentQueuedMessages, getAgentQueuedMessageSnapshots, pokeAgentQueuedMessages, updateAgentPermissionMode, rewindAgentSession, setVisibleAgentSession } from './lib/agent-service'
import { spawnExpertCowork } from './lib/agent-cowork'
import { permissionService } from './lib/agent-permission-service'
import { askUserService } from './lib/agent-ask-user-service'
import { exitPlanService } from './lib/agent-exit-plan-service'
import { getAgentSessionWorkspacePath, getAgentWorkspacesDir, getConfigDir, getWorkspaceSkillsDir, getWorkspaceFilesDir, getScratchPadPath, getExpertsDir, getDefaultExpertTemplatesDir } from './lib/config-paths'
import { realpathOrResolve, getAuthorizedRoots, isUnderRoot, isPathAllowed, getResolvedAuthorizedRoots, isResolvedPathAllowed, getWorkspaceSlugsForAccess, getManagedSkillBasePath, getAllowedCandidateBasePaths, getLegacySkillBasePath, getPreviewCandidateBasePaths, resolveFileAccessPath, getAccessRootMainRepo, ensurePathAllowed, ensurePathAllowedWithWorktree } from './ipc/path-access'
import { registerRuntimeHandlers } from './ipc/runtime-handlers'
import { registerAttachmentHandlers } from './ipc/attachment-handlers'
import { getBundledResourcesDir } from './lib/resources-path'
import { runCmd } from './lib/run-command'
import { registerVaultHandlers } from './ipc/vault-handlers'
import { registerAutomationHandlers } from './ipc/automation-handlers'
import { isNonEmptyString } from './ipc/validators'
import { registerFeishuQrHandlers } from './ipc/feishu-qr-handlers'
import { registerWorkspaceMemoryHandlers } from './ipc/workspace-memory-handlers'
import { registerAgentSessionHandlers } from './ipc/agent-session-handlers'
import { registerChannelHandlers } from './ipc/channel-handlers'
import { registerAgentWorkspaceAdminHandlers } from './ipc/agent-workspace-admin-handlers'
import { registerAppSettingsHandlers } from './ipc/app-settings-handlers'
import { registerScratchPadHandlers } from './ipc/scratch-pad-handlers'
import { registerDiscoverHandlers } from './ipc/discover-handlers'
import { registerAgentPermissionHandlers } from './ipc/agent-permission-handlers'
import { registerDingtalkHandlers } from './ipc/dingtalk-handlers'
import { registerWechatHandlers } from './ipc/wechat-handlers'
import { registerConversationHandlers } from './ipc/conversation-handlers'
import { registerFeishuHandlers } from './ipc/feishu-handlers'
import { registerPlanningHandlers } from './ipc/planning-handlers'
import { registerAgentAttachmentHandlers } from './ipc/agent-attachment-handlers'
import { registerAgentFilesystemHandlers } from './ipc/agent-filesystem-handlers'
import { registerProjectSkillMcpHandlers } from './ipc/project-skill-mcp-handlers'
import { registerSessionFilesAndTerminalHandlers } from './ipc/session-files-and-terminal-handlers'
import { registerExcalidrawHandlers } from './ipc/excalidraw-handlers'
import { resolveAgentSessionFileRoots } from './lib/agent-file-roots'
import { listSessionOutputs } from './lib/agent-output-capture'
import { getAgentWorkspacePath } from './lib/config-paths'
import { getCachedDefaultAppInfo, saveCachedDefaultAppInfo } from './lib/default-app-cache'
import { calculateStorageStats, cleanupStorage, cleanupTempFiles, cleanupDiscoverCache, previewArchivedCleanup, previewStripOversizedImages, stripOversizedImages } from './lib/storage-service'
import type { CleanupOptions } from './lib/storage-service'
import { getAgentUsageStats } from './lib/agent-usage'
import type { UsageRange } from './lib/agent-usage'
import { getProjectToWorkspaceMigrationStatus, runProjectToWorkspaceMigration, type ProjectToWorkspaceMigrationResult } from './lib/project-to-workspace-migration'
import { listWorkspaceAssets, uploadWorkspaceAsset, deleteWorkspaceAsset, type WorkspaceAssetInfo } from './lib/workspace-assets'
import {
  listAgentWorkspaces,
  createAgentWorkspace,
  updateAgentWorkspace,
  deleteAgentWorkspace,
  assertAgentWorkspaceDeletionSafe,
  reorderAgentWorkspaces,
  relinkAgentWorkspaceProjectRoot,
  restoreAgentWorkspaceProjectRoot,
  ensureDefaultWorkspace,
  getWorkspaceMcpConfig,
  saveWorkspaceMcpConfig,
  getDisabledCliIntegrationIds,
  setCliIntegrationEnabled,
  getAllEffectiveSkills,
  toggleGlobalSkill,
  deleteGlobalSkill,
  getAllWorkspaceSkills,
  getOtherWorkspaceSkills,
  getDefaultSkillSlugs,
  getWorkspaceCapabilities,
  getAgentWorkspace,
  deleteWorkspaceSkill,
  hasProjectSkills,
  getProjectSkills,
  getProjectSkillsDir,
  deleteProjectSkill,
  toggleProjectSkill,
  removeWorkspaceMcpServer,
  getOtherProjectSkills,
  batchImportSkillsToProject,
  importSkillFromWorkspace,
  batchImportSkillsFromWorkspaces,
  updateSkillFromSource,
  importSkillFromOrganization,
  updateSkillFromOrganizationSource,
  readWorkspaceSkillContent,
  writeWorkspaceSkillContent,
  toggleWorkspaceSkill,
  listSkillFiles,
  readSkillFile,
  writeSkillFile,
  createSkillEntry,
  deleteSkillEntry,
  renameSkillEntry,
  getWorkspaceMemorySummary,
  readWorkspaceAgentsMd,
  writeWorkspaceAgentsMd,
  listWorkspaceAutoMemoryFiles,
  readWorkspaceAutoMemoryFile,
  writeWorkspaceAutoMemoryFile,
  approveWorkspaceProjectKnowledgeMaintenance,
  getWorkspaceAttachedDirectories,
  getWorkspaceAttachedFiles,
  attachWorkspaceDirectory,
  attachWorkspaceFile,
  detachWorkspaceDirectory,
  detachWorkspaceFile,
  getWorktreeRepos,
  addWorktreeRepo,
  removeWorktreeRepo,
  cleanupStaleWorkspaceAttachedPaths,
  getAgentDefaultWorkingDirectory,
  setAgentDefaultWorkingDirectory,
} from './lib/agent-workspace-manager'
import { getGlobalScopeReviewHints } from './lib/agent-global-scope-migration'
import { deleteWorkspaceCascade } from './lib/workspace-deletion-service'
import {
  getOrganizationConnection,
  setOrganizationConnection,
  clearOrganizationConnection,
  orgLogin,
  orgRegister,
  orgConnectWithApiKey,
  orgMe,
  orgCreate,
  orgJoin,
  orgListMembers,
  orgListSkills,
} from './lib/org-skill-service'
import { fetchCommunityManifest, installCommunitySkill } from './lib/community-skill-service'
import { projectRepository } from './lib/project-repository'
import { subscribeWorkspaceMemoryChanges } from './lib/workspace-memory-change-watcher'
import { confirmWorkspaceMemoryWindowClose, markWorkspaceMemoryWindowReady } from './lib/workspace-memory-window'
import { deleteMcpCredential, startMcpOAuth, saveMcpApiKey, saveMcpOAuthClientSecret } from './lib/mcp-oauth-service'

/**
 * 每次保存或刷新都会推进工作区代数，使较早的异步 MCP 刷新不能回写较新的配置。
 * 该代数仅用于进程内竞态保护，不写入用户的 mcp.json。
 */
const workspaceMcpRefreshGenerations = new Map<string, number>()
const workspaceMcpPendingValidations = new Map<string, Map<string, import('@guru/shared').McpServerEntry>>()

function advanceWorkspaceMcpRefreshGeneration(workspaceSlug: string): number {
  const generation = (workspaceMcpRefreshGenerations.get(workspaceSlug) ?? 0) + 1
  workspaceMcpRefreshGenerations.set(workspaceSlug, generation)
  return generation
}

function getWorkspaceMcpPendingValidation(workspaceSlug: string, name: string): import('@guru/shared').McpServerEntry | undefined {
  return workspaceMcpPendingValidations.get(workspaceSlug)?.get(name)
}

function setWorkspaceMcpPendingValidation(workspaceSlug: string, name: string, entry: import('@guru/shared').McpServerEntry): void {
  const pending = workspaceMcpPendingValidations.get(workspaceSlug) ?? new Map<string, import('@guru/shared').McpServerEntry>()
  pending.set(name, entry)
  workspaceMcpPendingValidations.set(workspaceSlug, pending)
}

function clearWorkspaceMcpPendingValidation(workspaceSlug: string, name: string): void {
  const pending = workspaceMcpPendingValidations.get(workspaceSlug)
  if (!pending) return
  pending.delete(name)
  if (pending.size === 0) workspaceMcpPendingValidations.delete(workspaceSlug)
}

function clearMissingWorkspaceMcpPendingValidations(workspaceSlug: string, serverNames: ReadonlySet<string>): void {
  const pending = workspaceMcpPendingValidations.get(workspaceSlug)
  if (!pending) return
  for (const name of pending.keys()) {
    if (!serverNames.has(name)) pending.delete(name)
  }
  if (pending.size === 0) workspaceMcpPendingValidations.delete(workspaceSlug)
}

function isWorkspaceMcpRefreshCurrent(workspaceSlug: string, generation: number): boolean {
  return workspaceMcpRefreshGenerations.get(workspaceSlug) === generation
}

interface McpRefreshValidation {
  name: string
  fingerprint: string
  lastTestResult: NonNullable<import('@guru/shared').McpServerEntry['lastTestResult']>
}

/**
 * 生成 MCP 可运行配置的稳定摘要。摘要只用于内存中比较，绝不记录或返回，避免暴露 headers/env 中的敏感值。
 */
export function getMcpEntryFingerprint(entry: import('@guru/shared').McpServerEntry): string {
  const sortedEntries = (record: Record<string, string> | undefined): Array<[string, string]> =>
    Object.entries(record ?? {}).sort(([left], [right]) => left.localeCompare(right))

  const canonical = {
    type: entry.type,
    command: entry.command ?? null,
    args: entry.args ? [...entry.args] : null,
    url: entry.url ?? null,
    headers: sortedEntries(entry.headers),
    env: sortedEntries(entry.env),
    timeout: entry.timeout ?? null,
    enabled: entry.enabled,
    isBuiltin: entry.isBuiltin ?? false,
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

/** 在固定上限内并发执行任务，保留输入顺序，避免同时启动过多 MCP 进程或网络连接。 */
export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  maxConcurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new Error('maxConcurrency 必须是正整数')
  }

  const results = new Array<R>(values.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex++
      results[index] = await mapper(values[index]!, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxConcurrency, values.length) }, worker))
  return results
}

/**
 * 只合并仍与验证开始时完全一致的条目。调用方还必须检查 refresh generation，
 * 因而同名服务器被编辑、禁用、删除或被后一次刷新取代时，旧结果不会落盘。
 */
export function mergeMcpRefreshResults(
  currentConfig: import('@guru/shared').WorkspaceMcpConfig,
  validations: readonly McpRefreshValidation[],
): import('@guru/shared').WorkspaceMcpConfig {
  const servers = { ...currentConfig.servers }
  for (const validation of validations) {
    const currentEntry = servers[validation.name]
    if (currentEntry?.enabled && getMcpEntryFingerprint(currentEntry) === validation.fingerprint) {
      servers[validation.name] = {
        ...currentEntry,
        enabled: validation.lastTestResult.success,
        lastTestResult: validation.lastTestResult,
      }
    }
  }
  return { servers }
}

/**
 * 在该条目保持 disabled 落盘的状态下验证启用候选。若验证期间配置已被改动，
 * 返回最新快照而不是覆盖它。验证失败会落盘为 disabled，确保无效 MCP 不会被运行时加载。
 */
async function validateAndConditionallyPersistMcp(
  workspaceSlug: string,
  name: string,
  candidateEntry: import('@guru/shared').McpServerEntry,
  expectedPersistedFingerprint: string,
  expectedRefreshGeneration: number,
): Promise<import('@guru/shared').McpConnectionMutationResult> {
  const { validateMcpServer } = await import('./lib/mcp-validator')
  const result = await validateMcpServer(name, candidateEntry, workspaceSlug)
  const verification = {
    success: result.valid,
    message: result.valid ? (result.message ?? 'MCP 连接成功') : (result.reason ?? 'MCP 连接失败'),
  }
  const current = getWorkspaceMcpConfig(workspaceSlug)
  const currentEntry = current.servers[name]
  if (
    !isWorkspaceMcpRefreshCurrent(workspaceSlug, expectedRefreshGeneration) ||
    !currentEntry ||
    getMcpEntryFingerprint(currentEntry) !== expectedPersistedFingerprint
  ) {
    return { config: current, verification }
  }

  const nextEntry = {
    ...candidateEntry,
    enabled: verification.success,
    lastTestResult: { ...verification, timestamp: Date.now() },
  }
  const config = { servers: { ...current.servers, [name]: nextEntry } }
  clearWorkspaceMcpPendingValidation(workspaceSlug, name)
  saveWorkspaceMcpConfig(workspaceSlug, config)
  return { config, verification }
}

async function runCliProbe(
  runner: CliCommandRunner,
  bin: string,
  args: string[],
): Promise<CliCommandResult> {
  try {
    return await runner(bin, args, { timeoutMs: 2_000 })
  } catch {
    return { status: null, stdout: '' }
  }
}

/**
 * `dws auth status --format json` 是官方的非交互认证探测。只接受其完整、成功且 token 有效的结果；
 * 不读取、返回或持久化 CLI 输出中的任何身份字段。
 */
function isDingTalkCliAuthenticated(result: CliCommandResult): boolean {
  if (result.status !== 0) return false

  try {
    const status = JSON.parse(result.stdout) as {
      success?: unknown
      authenticated?: unknown
      token_valid?: unknown
    }
    return status.success === true && status.authenticated === true && status.token_valid === true
  } catch {
    return false
  }
}

/**
 * 仅将可由 CLI 本身的认证探测确认的集成标记为已连接；命令不存在、超时、未认证和未知探测均保守为 false。
 */
export async function getCliIntegrationStatuses(
  runner: CliCommandRunner = runCliCommand,
  disabledIds: ReadonlySet<string> = new Set(),
): Promise<import('@guru/shared').CliIntegrationStatus[]> {
  const [wecom, dingtalk, github, feishu] = await Promise.all([
    runCliProbe(runner, 'wecom-cli', ['auth', 'show', '--status']),
    runCliProbe(runner, 'dws', ['auth', 'status', '--format', 'json']),
    runCliProbe(runner, 'gh', ['auth', 'status', '--active']),
    runCliProbe(runner, 'lark-cli', ['auth', 'status', '--verify']),
  ])

  return [
    { id: 'wecom-cli', connected: wecom.status === 0 && wecom.stdout.trim().toLowerCase() === 'authorized', enabled: !disabledIds.has('wecom-cli') },
    { id: 'dingtalk-cli', connected: isDingTalkCliAuthenticated(dingtalk), enabled: !disabledIds.has('dingtalk-cli') },
    { id: 'github-cli', connected: github.status === 0, enabled: !disabledIds.has('github-cli') },
    { id: 'feishu-cli', connected: feishu.status === 0, enabled: !disabledIds.has('feishu-cli') },
  ]
}

import { getAllToolInfos } from './lib/chat-tool-registry'
import { updateToolState, updateToolCredentials, getToolCredentials, addCustomTool, deleteCustomTool } from './lib/chat-tool-config'
import {
  getSystemPromptConfig,
  createSystemPrompt,
  updateSystemPrompt,
  deleteSystemPrompt,
  updateAppendSetting,
  setDefaultPrompt,
} from './lib/system-prompt-manager'
import {
  getLatestRelease,
  listReleases as listGitHubReleases,
  getReleaseByTag,
} from './lib/github-release-service'
import {
  getReleaseNotesList,
  getLatestReleaseVersion,
  getCombinedReleaseNotes,
} from './lib/release-notes-service'
import { watchAttachedDirectory, unwatchAttachedDirectory } from './lib/workspace-watcher'
import {
  getFeishuConfig,
  saveFeishuConfig,
  getDecryptedAppSecret,
  getFeishuMultiBotConfig,
  saveFeishuBotConfig,
  removeFeishuBot,
  getDecryptedBotAppSecret,
} from './lib/feishu-config'
import { feishuBridgeManager } from './lib/feishu-bridge-manager'
import { syncFeishuSyncSleepBlocker } from './lib/feishu-sleep-blocker'
import { presenceService } from './lib/feishu-presence'
import { getDingTalkConfig, saveDingTalkConfig, getDecryptedClientSecret, getDingTalkMultiBotConfig, saveDingTalkBotConfig, removeDingTalkBot, getDecryptedBotClientSecret } from './lib/dingtalk-config'
import { listShallowDirectory } from './lib/directory-listing'
import { dingtalkBridgeManager } from './lib/dingtalk-bridge-manager'
import { getWeChatConfig } from './lib/wechat-config'
import { wechatBridge } from './lib/wechat-bridge'
import { getSlackSettingsConfig, removeSlackBot, saveSlackBotConfig, toSlackBotSettingsConfig } from './lib/slack-config'
import { slackBridgeManager } from './lib/slack-bridge-manager'
import { buildSlackManifest } from './lib/slack/manifest'
import { redactSensitiveLogValue } from './lib/bridge-log-redaction'
import { normalizeFileAccessOptions } from './lib/file-access-policy'
import { isSafeDeleteTarget } from './lib/destructive-file-policy'
import { getWorkspaceMetadataDirNames } from './lib/storage-boundaries'
import { repoMapToolsService } from './lib/repo-map-tools-service'

/**
 * 检查路径是否在允许的目录范围内（解析 symlink）
 *
 * extraAllowedPaths 来自 renderer 的 basePaths（用户通过 UI 附加的目录），
 * 虽然 renderer 不可信，但附加目录功能本身就允许用户授权 workspaces 外的路径访问。
 * 攻击者需要先控制 renderer 才能伪造 basePaths，此时已有更大的攻击面。
 */


type CliCommandResult = { status: number | null; stdout: string }
type CliCommandRunner = (bin: string, args: string[], opts: { timeoutMs?: number }) => Promise<CliCommandResult>

/**
 * npm 安装的 CLI 在 Windows 上通常以 .cmd shim 暴露。把 cmd.exe 路径严格限制在
 * 固定的目录探测命令里，而不是为通用 runCmd 打开 shell。
 */
export function getCliProbeInvocation(
  bin: string,
  args: string[],
  platform = process.platform,
  comSpec = process.env.ComSpec,
): { bin: string; args: string[] } {
  if (platform !== 'win32') return { bin, args }
  return {
    bin: comSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', [bin, ...args].join(' ')],
  }
}

async function runCliCommand(bin: string, args: string[], opts: { timeoutMs?: number }): Promise<CliCommandResult> {
  const invocation = getCliProbeInvocation(bin, args)
  return runCmd(invocation.bin, invocation.args, opts)
}

function isAgentRuntime(value: unknown): value is AgentRuntime {
  // Pi-only：所有 runtime 值归一化为 'pi'，历史 'claude' 仅用于兼容读取。
  return value === 'pi' || value === 'claude'
}

/**
 * 解析应用图标变体的文件路径
 */
export function resolveAppIconPath(variantId: string): string | null {
  const resourcesDir = getBundledResourcesDir()
  if (!variantId || variantId === 'default') {
    return join(resourcesDir, 'icon.png')
  }
  return join(resourcesDir, 'logos', `${variantId}.png`)
}

let ipcHandlersRegistered = false

export function registerIpcHandlers(): void {
  if (ipcHandlersRegistered) {
    console.warn('[IPC] 处理器已注册，跳过重复注册')
    return
  }
  ipcHandlersRegistered = true
  console.log('[IPC] 正在注册 IPC 处理器...')

  // ===== 运行时相关 =====
  registerRuntimeHandlers()

  // ===== 渠道管理相关 =====
  registerChannelHandlers()

  // ===== 对话管理相关 =====
  registerConversationHandlers()

  // ===== 附件管理相关 =====
  registerAttachmentHandlers()

  // ===== 用户档案相关 =====

  // 获取用户档案
  ipcMain.handle(
    USER_PROFILE_IPC_CHANNELS.GET,
    async (): Promise<UserProfile> => {
      return getUserProfile()
    }
  )

  // 更新用户档案
  ipcMain.handle(
    USER_PROFILE_IPC_CHANNELS.UPDATE,
    async (_, updates: Partial<UserProfile>): Promise<UserProfile> => {
      return updateUserProfile(updates)
    }
  )

  // ===== 应用设置相关 =====
  registerAppSettingsHandlers()

  // ===== Scratch Pad 持久化 =====
  registerScratchPadHandlers()

  // ===== Excalidraw 画布 =====
  registerExcalidrawHandlers()

  // ===== Dock/Launcher 角标 =====

  ipcMain.handle(
    DOCK_BADGE_IPC_CHANNELS.SET_COUNT,
    async (_, count: number): Promise<boolean> => {
      return setDockBadgeCount(count)
    }
  )

  // ===== 环境检测相关 =====

  // 执行环境检测
  ipcMain.handle(
    ENVIRONMENT_IPC_CHANNELS.CHECK,
    async (): Promise<EnvironmentCheckResult> => {
      const result = await checkEnvironment()
      // 自动保存检测结果到设置
      await updateSettings({
        lastEnvironmentCheck: result,
      })
      return result
    }
  )

  // ===== 第三方安装包（Git / Node.js）相关 =====

  ipcMain.handle(
    INSTALLER_IPC_CHANNELS.MANIFEST,
    async (): Promise<InstallerManifest> => {
      return fetchInstallerManifest()
    }
  )

  ipcMain.handle(
    INSTALLER_IPC_CHANNELS.DOWNLOAD,
    async (event, req: InstallerDownloadRequest): Promise<InstallerDownloadResult> => {
      const manifest = await fetchInstallerManifest()
      const source = findInstallerSource(manifest, req.id, req.arch)
      if (!source) {
        throw new Error(`未找到安装包：id=${req.id}, arch=${req.arch}`)
      }
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) {
        throw new Error('发起下载的窗口已关闭')
      }
      const key = `${req.id}:${req.arch}`
      return downloadInstaller(source, key, window)
    }
  )

  ipcMain.handle(
    INSTALLER_IPC_CHANNELS.CANCEL,
    async (_event, key: string): Promise<boolean> => {
      return cancelInstallerDownload(key)
    }
  )

  ipcMain.handle(
    INSTALLER_IPC_CHANNELS.LAUNCH,
    async (_event, filePath: string): Promise<void> => {
      await launchInstaller(filePath)
    }
  )

  // ===== 代理配置相关 =====

  // 获取代理配置
  ipcMain.handle(
    PROXY_IPC_CHANNELS.GET_SETTINGS,
    async (): Promise<ProxyConfig> => {
      return getProxySettings()
    }
  )

  // 更新代理配置
  ipcMain.handle(
    PROXY_IPC_CHANNELS.UPDATE_SETTINGS,
    async (_, config: ProxyConfig): Promise<void> => {
      await saveProxySettings(config)
    }
  )

  // 检测系统代理
  ipcMain.handle(
    PROXY_IPC_CHANNELS.DETECT_SYSTEM,
    async (): Promise<SystemProxyDetectResult> => {
      return detectSystemProxy()
    }
  )

  // ===== Agent 会话管理相关 =====
  registerAgentSessionHandlers()

  // ===== Agent 工作区管理相关 =====
  registerAgentWorkspaceAdminHandlers()

  // ===== 工作区资产（项目=工作区模型下的资产库，对齐 craft） =====

  // 列出工作区资产
  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_WORKSPACE_ASSETS,
    async (_event, workspaceSlug: string): Promise<WorkspaceAssetInfo[]> => {
      return listWorkspaceAssets(workspaceSlug)
    }
  )

  // 上传工作区资产（base64）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.UPLOAD_WORKSPACE_ASSET,
    async (_event, workspaceSlug: string, filename: string, base64: string): Promise<WorkspaceAssetInfo> => {
      return uploadWorkspaceAsset(workspaceSlug, filename, base64)
    }
  )

  // 删除工作区资产
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_WORKSPACE_ASSET,
    async (_event, workspaceSlug: string, filename: string): Promise<void> => {
      deleteWorkspaceAsset(workspaceSlug, filename)
    }
  )

  // ===== 工作区能力（MCP + Skill） =====

  // 获取工作区能力摘要
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_CAPABILITIES,
    async (_, workspaceSlug: string): Promise<WorkspaceCapabilities> => {
      return getWorkspaceCapabilities(workspaceSlug)
    }
  )

  // 获取工作区 MCP 配置（对齐上游 #2037：MCP 为工作区级存储，UI 唯一入口）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_MCP_CONFIG,
    async (_, workspaceSlug: string): Promise<WorkspaceMcpConfig> => {
      return getWorkspaceMcpConfig(workspaceSlug)
    }
  )

  // 防御式保存整个工作区 MCP 配置：renderer 传入的测试结果仅是可展示数据，不能作为加载授权。
  // 新启用或变更的条目先以 disabled 落盘，并走与卡片开关一致的真实验证后才允许启用。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SAVE_MCP_CONFIG,
    async (_, workspaceSlug: string, config: WorkspaceMcpConfig, options?: import('@guru/shared').SaveWorkspaceMcpConfigOptions): Promise<void> => {
      for (const name of options?.explicitlyDisabledServerNames ?? []) {
        clearWorkspaceMcpPendingValidation(workspaceSlug, name)
      }
      const pendingValidations: Array<{ name: string; candidate: import('@guru/shared').McpServerEntry }> = []
      const servers: WorkspaceMcpConfig['servers'] = {}

      const configServerNames = new Set(Object.keys(config.servers))
      clearMissingWorkspaceMcpPendingValidations(workspaceSlug, configServerNames)
      for (const [name, entry] of Object.entries(config.servers)) {
        const entryWithoutTestResult = { ...entry }
        delete entryWithoutTestResult.lastTestResult
        const candidate = { ...entryWithoutTestResult, enabled: true }
        if (entry.enabled) {
          // lastTestResult 是 renderer 可见的展示数据，不是可加载证明。
          // 每个 enabled 条目都必须重新真实验证，包括旧版本创建或手工编辑过的配置。
          servers[name] = { ...entryWithoutTestResult, enabled: false }
          pendingValidations.push({ name, candidate })
          setWorkspaceMcpPendingValidation(workspaceSlug, name, candidate)
        } else {
          const pendingCandidate = getWorkspaceMcpPendingValidation(workspaceSlug, name)
          const pendingEntry = pendingCandidate ? { ...pendingCandidate, enabled: false } : undefined
          if (pendingEntry && getMcpEntryFingerprint(pendingEntry) === getMcpEntryFingerprint(entry)) {
            servers[name] = pendingEntry
            pendingValidations.push({ name, candidate: pendingCandidate! })
          } else {
            clearWorkspaceMcpPendingValidation(workspaceSlug, name)
            // 不为 disabled 条目持久化 renderer 提供的验证数据。
            servers[name] = entryWithoutTestResult
          }
        }
      }

      const pendingConfig = { servers }
      const refreshGeneration = advanceWorkspaceMcpRefreshGeneration(workspaceSlug)
      saveWorkspaceMcpConfig(workspaceSlug, pendingConfig)
      for (const validation of pendingValidations) {
        await validateAndConditionallyPersistMcp(
          workspaceSlug,
          validation.name,
          validation.candidate,
          getMcpEntryFingerprint(pendingConfig.servers[validation.name]!),
          refreshGeneration,
        )
      }
    }
  )

  // 原子切换单个 MCP：任何更晚的保存都会推进工作区 refresh generation，
  // 而 fingerprint 匹配保护本条目的验证回写。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SET_MCP_ENABLED_AND_VALIDATE,
    async (_, workspaceSlug: string, name: string, enabled: boolean): Promise<import('@guru/shared').McpConnectionMutationResult> => {
      const current = getWorkspaceMcpConfig(workspaceSlug)
      const entry = current.servers[name]
      if (!entry) throw new Error('找不到 MCP 配置')

      const entryWithoutTestResult = { ...entry }
      delete entryWithoutTestResult.lastTestResult
      if (!enabled) {
        const config = { servers: { ...current.servers, [name]: { ...entry, enabled: false } } }
        advanceWorkspaceMcpRefreshGeneration(workspaceSlug)
        clearWorkspaceMcpPendingValidation(workspaceSlug, name)
        saveWorkspaceMcpConfig(workspaceSlug, config)
        return { config, verification: { success: true, message: 'MCP 已关闭' } }
      }

      // 保持条目 disabled 直到真实握手成功，避免运行时反复启动已知无效的服务器。
      const pendingEntry = { ...entryWithoutTestResult, enabled: false }
      const pendingConfig = { servers: { ...current.servers, [name]: pendingEntry } }
      // 将候选条目保留在内存中：握手期间发生无关的整配置保存时，
      // 会保留并继续验证，而不是把临时 disabled 当成用户主动关闭。
      const refreshGeneration = advanceWorkspaceMcpRefreshGeneration(workspaceSlug)
      setWorkspaceMcpPendingValidation(workspaceSlug, name, { ...entryWithoutTestResult, enabled: true })
      saveWorkspaceMcpConfig(workspaceSlug, pendingConfig)
      return validateAndConditionallyPersistMcp(
        workspaceSlug,
        name,
        { ...entryWithoutTestResult, enabled: true },
        getMcpEntryFingerprint(pendingEntry),
        refreshGeneration,
      )
    }
  )

  // 原子安装目录 MCP：已有配置优先，不被 renderer 的过期快照覆盖。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.INSTALL_MCP_AND_VALIDATE,
    async (_, workspaceSlug: string, name: string, entry: import('@guru/shared').McpServerEntry): Promise<import('@guru/shared').McpInstallMutationResult> => {
      const current = getWorkspaceMcpConfig(workspaceSlug)
      if (current.servers[name]) {
        return {
          installed: false,
          config: current,
          verification: { success: Boolean(current.servers[name]?.lastTestResult?.success), message: 'MCP 已存在' },
        }
      }

      const entryWithoutTestResult = { ...entry }
      delete entryWithoutTestResult.lastTestResult
      if (!entry.enabled) {
        const config = { servers: { ...current.servers, [name]: entryWithoutTestResult } }
        advanceWorkspaceMcpRefreshGeneration(workspaceSlug)
        saveWorkspaceMcpConfig(workspaceSlug, config)
        return { installed: true, config, verification: { success: true, message: 'MCP 已添加，等待配置' } }
      }

      // 新安装的目录 MCP 同样保持 disabled 直到验证通过。
      const pendingEntry = { ...entryWithoutTestResult, enabled: false }
      const pendingConfig = { servers: { ...current.servers, [name]: pendingEntry } }
      // 将候选条目保留在内存中：握手期间发生无关的整配置保存时，
      // 会保留并继续验证，而不是把临时 disabled 当成用户主动关闭。
      const refreshGeneration = advanceWorkspaceMcpRefreshGeneration(workspaceSlug)
      setWorkspaceMcpPendingValidation(workspaceSlug, name, { ...entryWithoutTestResult, enabled: true })
      saveWorkspaceMcpConfig(workspaceSlug, pendingConfig)
      const result = await validateAndConditionallyPersistMcp(
        workspaceSlug,
        name,
        { ...entryWithoutTestResult, enabled: true },
        getMcpEntryFingerprint(pendingEntry),
        refreshGeneration,
      )
      return { installed: true, ...result }
    }
  )

  // 刷新并持久化工作区 MCP 真实连接状态
  ipcMain.handle(
    AGENT_IPC_CHANNELS.REFRESH_MCP_CONNECTIONS,
    async (_, workspaceSlug: string): Promise<WorkspaceMcpConfig> => {
      const refreshGeneration = advanceWorkspaceMcpRefreshGeneration(workspaceSlug)
      const config = getWorkspaceMcpConfig(workspaceSlug)
      const entries = Object.entries(config.servers).filter(([, entry]) => entry.enabled)
      const { validateMcpServer } = await import('./lib/mcp-validator')
      const validations = await mapWithConcurrency(entries, 4, async ([name, entry]) => {
        const result = await validateMcpServer(name, entry, workspaceSlug)
        return {
          name,
          fingerprint: getMcpEntryFingerprint(entry),
          lastTestResult: {
            success: result.valid,
            message: result.valid ? (result.message ?? 'MCP 连接成功') : (result.reason ?? 'MCP 连接失败'),
            timestamp: Date.now(),
          },
        }
      })

      // 保存或更晚发起的刷新会使本次 generation 过期；直接返回最新完整配置，不写任何旧验证结果。
      if (!isWorkspaceMcpRefreshCurrent(workspaceSlug, refreshGeneration)) {
        return getWorkspaceMcpConfig(workspaceSlug)
      }

      const refreshed = mergeMcpRefreshResults(getWorkspaceMcpConfig(workspaceSlug), validations)
      saveWorkspaceMcpConfig(workspaceSlug, refreshed)
      return refreshed
    }
  )

  // 启动远程 MCP 的 OAuth PKCE 授权（不向 renderer 暴露任何凭据）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.START_MCP_OAUTH,
    async (_, input: import('@guru/shared').StartMcpOAuthInput): Promise<import('@guru/shared').McpOAuthStartResult> => {
      return startMcpOAuth(input)
    }
  )

  // 将 OAuth client secret 加密保存到系统 Keychain
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SAVE_MCP_OAUTH_CLIENT_SECRET,
    (_, input: import('@guru/shared').SaveMcpOAuthClientSecretInput): void => {
      saveMcpOAuthClientSecret(input)
    }
  )

  // 安全保存远程 MCP 的静态 API Key / Token
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SAVE_MCP_API_KEY,
    async (_, input: import('@guru/shared').SaveMcpApiKeyInput): Promise<void> => {
      return saveMcpApiKey(input)
    }
  )

  // renderer 先移除传输配置，再调用此 handler 只删除匹配的加密 Keychain 载荷。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_MCP_CREDENTIAL,
    async (_, workspaceSlug: string, serverName: string): Promise<void> => {
      return deleteMcpCredential(workspaceSlug, serverName)
    }
  )

  // 查询本机 CLI 集成状态（含当前工作区的启用状态；不返回任何凭据）。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_CLI_INTEGRATION_STATUSES,
    async (_, workspaceSlug: string): Promise<import('@guru/shared').CliIntegrationStatus[]> => {
      return getCliIntegrationStatuses(undefined, getDisabledCliIntegrationIds(workspaceSlug))
    }
  )

  // 仅切换 Guru 对工作区 CLI 集成的使用权限；绝不登出或撤销第三方授权。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SET_CLI_INTEGRATION_ENABLED,
    async (_, workspaceSlug: string, id: string, enabled: boolean): Promise<import('@guru/shared').CliIntegrationStatus[]> => {
      setCliIntegrationEnabled(workspaceSlug, id, enabled)
      return getCliIntegrationStatuses(undefined, getDisabledCliIntegrationIds(workspaceSlug))
    }
  )

  // 获取全局作用域迁移后续提示（遗留工作区 mcp.json / 同名冲突后缀）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_GLOBAL_SCOPE_REVIEW_HINTS,
    async (): Promise<import('@guru/shared').GlobalScopeReviewHints> => {
      return getGlobalScopeReviewHints()
    }
  )

  // 获取全局 Skills 目录绝对路径
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_GLOBAL_SKILLS_DIR,
    async (): Promise<string> => {
      const { getGlobalSkillsDir } = await import('./lib/config-paths')
      return getGlobalSkillsDir()
    }
  )

  // 测试 MCP 服务器连接（真实握手；传 workspaceSlug 以注入该工作区的 OAuth/API-key 凭据）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TEST_MCP_SERVER,
    async (_, workspaceSlug: string, name: string, entry: import('@guru/shared').McpServerEntry): Promise<{ success: boolean; message: string }> => {
      const { validateMcpServer } = await import('./lib/mcp-validator')
      const result = await validateMcpServer(name, entry, workspaceSlug)
      return {
        success: result.valid,
        message: result.valid ? (result.message ?? '连接成功') : (result.reason || '连接失败'),
      }
    }
  )

  // 测试内置连接器依赖（Chrome / npx 等，不拉起完整 MCP 会话）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TEST_BUILTIN_CONNECTOR,
    async (_, id: string): Promise<{ success: boolean; message: string }> => {
      if (id === 'chrome-devtools') {
        const { resolveChromeDevtoolsAvailability } = await import('./lib/builtin-mcp/chrome-devtools-availability')
        const result = resolveChromeDevtoolsAvailability()
        return {
          success: result.available,
          message: result.available
            ? '已检测到 Chrome 与 npx，可以启动浏览器连接器'
            : (result.reason ?? '浏览器连接器不可用'),
        }
      }
      return { success: false, message: '该连接器请在配置表单中测试' }
    }
  )

  // 启用或关闭 Guru 内置 MCP
  ipcMain.handle(
    AGENT_IPC_CHANNELS.SET_BUILTIN_MCP_ENABLED,
    async (_, workspaceSlug: string, id: string, enabled: boolean): Promise<WorkspaceCapabilities> => {
      setBuiltinMcpUserEnabled(id, enabled)
      return getWorkspaceCapabilities(workspaceSlug)
    }
  )

  // 获取工作区 Skill 列表（含活跃和不活跃，设置页 UI 用）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_SKILLS,
    async (_, workspaceSlug: string): Promise<SkillMeta[]> => {
      return getAllWorkspaceSkills(workspaceSlug)
    }
  )

  // 获取工作区 Skills 目录绝对路径
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_SKILLS_DIR,
    async (_, workspaceSlug: string): Promise<string> => {
      return getWorkspaceSkillsDir(workspaceSlug)
    }
  )

  // 删除工作区 Skill
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_SKILL,
    async (_, workspaceSlug: string, skillSlug: string): Promise<void> => {
      return deleteWorkspaceSkill(workspaceSlug, skillSlug)
    }
  )

  // 切换工作区 Skill 启用/禁用
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TOGGLE_SKILL,
    async (_, workspaceSlug: string, skillSlug: string, enabled: boolean): Promise<void> => {
      return toggleWorkspaceSkill(workspaceSlug, skillSlug, enabled)
    }
  )

  // 获取全局+工作区+项目三层合并后的生效 Skill 列表（插件中心 UI 用，带 scope/shadowedByGlobal）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_ALL_EFFECTIVE_SKILLS,
    async (_, workspaceSlug: string | undefined, projectId?: string): Promise<SkillMeta[]> => {
      return getAllEffectiveSkills(workspaceSlug, projectId)
    }
  )

  // 删除全局 Skill
  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_GLOBAL_SKILL,
    async (_, skillSlug: string): Promise<void> => {
      return deleteGlobalSkill(skillSlug)
    }
  )

  // 切换全局 Skill 启用/禁用
  ipcMain.handle(
    AGENT_IPC_CHANNELS.TOGGLE_GLOBAL_SKILL,
    async (_, skillSlug: string, enabled: boolean): Promise<void> => {
      return toggleGlobalSkill(skillSlug, enabled)
    }
  )

  // 获取其他工作区的 Skill 列表
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_OTHER_WORKSPACE_SKILLS,
    async (_, currentSlug: string) => {
      return getOtherWorkspaceSkills(currentSlug)
    }
  )

  // 获取默认 Skills 的 slug 列表（来自 ~/.guru/default-skills/）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_DEFAULT_SKILL_SLUGS,
    async () => {
      return getDefaultSkillSlugs()
    }
  )

  // ===== 项目级 Skills / MCP（嵌套 Project 可选覆盖工作区级，不影响上述工作区级通道） =====
  registerProjectSkillMcpHandlers()

  // ===== Skill 子文件管理 =====
  // 以下通道均支持可选 scope/projectId 参数（默认 scope='workspace' 保持既有行为不变），
  // 用于定位到全局/项目层 Skill 的子文件。

  ipcMain.handle(
    AGENT_IPC_CHANNELS.LIST_SKILL_FILES,
    async (_, workspaceSlug: string, skillSlug: string, scope?: SkillScope, projectId?: string) => {
      return listSkillFiles(workspaceSlug, skillSlug, scope, projectId)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.READ_SKILL_FILE,
    async (_, workspaceSlug: string, skillSlug: string, relativePath: string, scope?: SkillScope, projectId?: string) => {
      return readSkillFile(workspaceSlug, skillSlug, relativePath, scope, projectId)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.WRITE_SKILL_FILE,
    async (_, workspaceSlug: string, skillSlug: string, relativePath: string, content: string, scope?: SkillScope, projectId?: string): Promise<void> => {
      writeSkillFile(workspaceSlug, skillSlug, relativePath, content, scope, projectId)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.CREATE_SKILL_ENTRY,
    async (_, workspaceSlug: string, skillSlug: string, relativePath: string, type: 'file' | 'directory', scope?: SkillScope, projectId?: string): Promise<void> => {
      createSkillEntry(workspaceSlug, skillSlug, relativePath, type, scope, projectId)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.DELETE_SKILL_ENTRY,
    async (_, workspaceSlug: string, skillSlug: string, relativePath: string, scope?: SkillScope, projectId?: string): Promise<void> => {
      deleteSkillEntry(workspaceSlug, skillSlug, relativePath, scope, projectId)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.RENAME_SKILL_ENTRY,
    async (_, workspaceSlug: string, skillSlug: string, fromRelative: string, toRelative: string, scope?: SkillScope, projectId?: string): Promise<void> => {
      renameSkillEntry(workspaceSlug, skillSlug, fromRelative, toRelative, scope, projectId)
    }
  )

  // ===== 工作区记忆文件管理 =====
  registerWorkspaceMemoryHandlers()

  // ===== Agent 队列消息 =====

  // 排队发送消息
  ipcMain.handle(
    AGENT_IPC_CHANNELS.QUEUE_MESSAGE,
    async (event, input: import('@guru/shared').AgentQueueMessageInput): Promise<string> => {
      return queueAgentMessage(input, event.sender)
    }
  )

  // 将等待当前 run 结束的消息交给主进程调度器
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ENQUEUE_QUEUED_MESSAGE,
    async (event, input: import('@guru/shared').AgentDeferredQueueMessageInput): Promise<void> => {
      enqueueAgentQueuedMessage(input, event.sender)
    }
  )

  // 获取主进程 deferred queue 的展示投影（renderer 重载后重建队列 UI）。
  // renderer 重新挂载/窗口重开是天然的重连信号：顺手 poke 一次，
  // 让因 webContents 缺失而搁置的派发在 renderer 回来后恢复。
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_QUEUED_MESSAGES,
    async (_, sessionId: string): Promise<import('@guru/shared').AgentQueuedMessageSnapshot[]> => {
      const snapshots = getAgentQueuedMessageSnapshots(sessionId)
      pokeAgentQueuedMessages()
      return snapshots
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.CANCEL_QUEUED_MESSAGE,
    async (_, input: import('@guru/shared').AgentQueuedMessageControlInput): Promise<boolean> => {
      return cancelAgentQueuedMessage(input)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.MOVE_QUEUED_MESSAGE,
    async (_, input: import('@guru/shared').AgentMoveQueuedMessageInput): Promise<boolean> => {
      return moveAgentQueuedMessage(input)
    }
  )

  // ===== Agent 后台任务管理 =====

  // 获取任务输出（保留接口，供未来扩展；Shell/后台任务输出能力尚未实现）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_TASK_OUTPUT,
    async (_, input: GetTaskOutputInput): Promise<GetTaskOutputResult> => {
      try {
        // TODO: 实现通过 SDK 的 TaskOutput 获取任务输出
        console.warn('[IPC] GET_TASK_OUTPUT: 当前版本暂未实现，返回空输出')
        return {
          output: '',
          isComplete: false,
        }
      } catch (error) {
        console.error('[IPC] 获取任务输出失败:', error)
        throw error
      }
    }
  )

  // ===== Agent 权限系统 =====
  registerAgentPermissionHandlers()

  // ===== Chat 工具管理 =====

  // 获取所有工具信息
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.GET_ALL_TOOLS,
    async (): Promise<ChatToolInfo[]> => {
      return getAllToolInfos()
    }
  )

  // 获取工具凭据
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.GET_TOOL_CREDENTIALS,
    async (_, toolId: string): Promise<Record<string, string>> => {
      return getToolCredentials(toolId)
    }
  )

  // 更新工具开关状态
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.UPDATE_TOOL_STATE,
    async (_, toolId: string, state: ChatToolState): Promise<void> => {
      updateToolState(toolId, state)
    }
  )

  // 更新工具凭据
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.UPDATE_TOOL_CREDENTIALS,
    async (_, toolId: string, credentials: Record<string, string>): Promise<void> => {
      updateToolCredentials(toolId, credentials)
    }
  )

  // 创建自定义工具
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.CREATE_CUSTOM_TOOL,
    async (_, meta: ChatToolMeta): Promise<void> => {
      addCustomTool(meta)
    }
  )

  // 删除自定义工具
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.DELETE_CUSTOM_TOOL,
    async (_, toolId: string): Promise<void> => {
      deleteCustomTool(toolId)
    }
  )

  // 测试工具连接
  ipcMain.handle(
    CHAT_TOOL_IPC_CHANNELS.TEST_TOOL,
    async (_, toolId: string): Promise<{ success: boolean; message: string }> => {
      // Nano Banana 生图工具测试
      if (toolId === 'nano-banana') {
        const { getToolCredentials: getCredentials } = await import('./lib/chat-tool-config')
        const credentials = getCredentials('nano-banana')
        if (!credentials.apiKey) {
          return { success: false, message: '请先填写 API Key' }
        }
        try {
          // ===== OpenAI Images 协议分支 =====
          if (credentials.provider === 'openai-images') {
            const baseUrl = (credentials.baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '')
            const model = credentials.model?.trim() || 'gpt-image-2'
            // 用 GET /models 验证 key 有效性（不消耗生图额度）
            const response = await fetch(`${baseUrl}/models`, {
              headers: { Authorization: `Bearer ${credentials.apiKey}` },
              signal: AbortSignal.timeout(15_000),
            })
            if (!response.ok) {
              const errorText = await response.text()
              return { success: false, message: `API 请求失败 (${response.status}): ${errorText.slice(0, 200)}` }
            }
            return { success: true, message: `连接成功，模型 ${model} 将在生成时调用` }
          }

          // ===== Gemini 协议分支 =====
          const baseUrl = credentials.baseUrl?.trim() || 'https://generativelanguage.googleapis.com'
          const model = credentials.model?.trim() || 'gemini-3.1-flash-image-preview'
          const url = `${baseUrl}/v1beta/models/${model}:generateContent`
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // 与调用路径一致：header 认证兼容官方与 nbility 等中转
              'x-goog-api-key': credentials.apiKey,
            },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
              generationConfig: { maxOutputTokens: 10 },
            }),
            signal: AbortSignal.timeout(15_000),
          })
          if (!response.ok) {
            const errorText = await response.text()
            return { success: false, message: `API 请求失败 (${response.status}): ${errorText.slice(0, 200)}` }
          }
          return { success: true, message: `连接成功，模型 ${model} 可用` }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          return { success: false, message: `连接失败: ${msg}` }
        }
      }
      return { success: false, message: `工具 ${toolId} 不支持测试` }
    }
  )

  // ===== AskUserQuestion 交互式问答 =====

  // 响应 AskUser 请求
  ipcMain.handle(
    AGENT_IPC_CHANNELS.ASK_USER_RESPOND,
    async (event, response: AskUserResponse): Promise<void> => {
      const { requestId, answers } = response
      const sessionId = askUserService.respondToAskUser(requestId, answers)

      if (sessionId) {
        event.sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
          sessionId,
          payload: { kind: 'guru_event', event: { type: 'ask_user_resolved', requestId } },
        })
      }
    }
  )

  // ===== ExitPlanMode 计划审批 =====

  // 响应 ExitPlanMode 请求
  ipcMain.handle(
    AGENT_IPC_CHANNELS.EXIT_PLAN_MODE_RESPOND,
    async (event, response: ExitPlanModeResponse): Promise<void> => {
      const result = exitPlanService.respondToExitPlanMode(response)

      if (result) {
        const { sessionId, targetMode } = result

        // 通知渲染进程请求已处理
        event.sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
          sessionId,
          payload: { kind: 'guru_event', event: { type: 'exit_plan_mode_resolved', requestId: response.requestId } },
        })

        // 如果用户选择了新的权限模式，通知渲染进程更新 UI
        if (targetMode) {
          const meta = getAgentSessionMeta(sessionId)
          // 持久化到 session meta，和 cycleMode 路径保持一致（重启后该 session 能恢复）
          if (meta) {
            try {
              updateAgentSessionMeta(sessionId, { permissionMode: targetMode })
            } catch (err) {
              console.warn(`[IPC] ExitPlanMode 持久化 session 权限模式失败: sessionId=${sessionId}`, err)
            }
          }
          event.sender.send(AGENT_IPC_CHANNELS.STREAM_EVENT, {
            sessionId,
            payload: { kind: 'guru_event', event: { type: 'permission_mode_changed', mode: targetMode } },
          })
          console.log(`[IPC] ExitPlanMode 权限模式切换: ${targetMode}`)
        }
      }
    }
  )

  // ===== 待处理请求恢复 =====

  // 获取所有待处理的交互请求快照（渲染进程重载后恢复状态）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_PENDING_REQUESTS,
    async (): Promise<import('@guru/shared').PendingRequestsSnapshot> => {
      return {
        permissions: permissionService.getPendingRequests(),
        askUsers: askUserService.getPendingRequests(),
        exitPlans: exitPlanService.getPendingRequests(),
      }
    }
  )

  // ===== 代码图谱工具（repo map + Graphify，2026-08-13） =====

  // 查询图谱工具状态（纯读，无副作用）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.REPO_MAP_TOOLS_GET_STATE,
    (_event, cwd: string) => repoMapToolsService.getState(cwd)
  )

  // 幂等创建（对话栏按钮唯一主动入口；构建异步完成，经 STATUS 推送）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.REPO_MAP_TOOLS_ENSURE,
    (_event, cwd: string, forceUpdate?: boolean) => repoMapToolsService.ensureMapTools(cwd, { forceUpdate: forceUpdate === true })
  )

  // 一键安装 graphify（进度经 INSTALL_PROGRESS 推送）
  ipcMain.handle(
    AGENT_IPC_CHANNELS.REPO_MAP_TOOLS_INSTALL,
    (event) => repoMapToolsService.installGraphify((line) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(AGENT_IPC_CHANNELS.REPO_MAP_TOOLS_INSTALL_PROGRESS, line)
      }
    })
  )

  // 卸载 graphify
  ipcMain.handle(
    AGENT_IPC_CHANNELS.REPO_MAP_TOOLS_UNINSTALL,
    (event) => repoMapToolsService.uninstallGraphify((line) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(AGENT_IPC_CHANNELS.REPO_MAP_TOOLS_INSTALL_PROGRESS, line)
      }
    })
  )

  // 状态变更推送（服务事件 → 所有窗口广播，渲染进程不轮询）
  repoMapToolsService.onStateChange((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(AGENT_IPC_CHANNELS.REPO_MAP_TOOLS_STATUS, state)
      }
    }
  })

  // ===== Agent 附件 =====
  registerAgentAttachmentHandlers()

  // ===== Worktree 仓库配置管理 =====

  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_WORKTREE_REPOS,
    async (_, workspaceSlug: string) => {
      return await getWorktreeRepos(workspaceSlug)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.ADD_WORKTREE_REPO,
    async (_, workspaceSlug: string, repo: import('@guru/shared').WorkspaceWorktreeRepo) => {
      return addWorktreeRepo(workspaceSlug, repo)
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.REMOVE_WORKTREE_REPO,
    async (_, workspaceSlug: string, repoPath: string) => {
      return removeWorktreeRepo(workspaceSlug, repoPath)
    }
  )

  // ===== 默认工作区目录（应用设置） =====

  ipcMain.handle(
    AGENT_IPC_CHANNELS.GET_AGENT_DEFAULT_WORKING_DIRECTORY,
    async (): Promise<string | undefined> => {
      return getAgentDefaultWorkingDirectory()
    }
  )

  ipcMain.handle(
    AGENT_IPC_CHANNELS.SET_AGENT_DEFAULT_WORKING_DIRECTORY,
    async (_, path: string | undefined): Promise<string | undefined> => {
      return setAgentDefaultWorkingDirectory(path)
    }
  )

  // ===== Agent 文件系统操作 =====
  registerAgentFilesystemHandlers()

  // ===== 会话内嵌终端（PTY） =====
  registerSessionFilesAndTerminalHandlers()

  // ===== 系统提示词管理 =====

  // 获取系统提示词配置
  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.GET_CONFIG,
    async (): Promise<SystemPromptConfig> => {
      return getSystemPromptConfig()
    }
  )

  // 创建提示词
  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.CREATE,
    async (_, input: SystemPromptCreateInput): Promise<SystemPrompt> => {
      return createSystemPrompt(input)
    }
  )

  // 更新提示词
  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.UPDATE,
    async (_, id: string, input: SystemPromptUpdateInput): Promise<SystemPrompt> => {
      return updateSystemPrompt(id, input)
    }
  )

  // 删除提示词
  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.DELETE,
    async (_, id: string): Promise<void> => {
      return deleteSystemPrompt(id)
    }
  )

  // 更新追加日期时间和用户名开关
  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.UPDATE_APPEND_SETTING,
    async (_, enabled: boolean): Promise<void> => {
      return updateAppendSetting(enabled)
    }
  )

  // 设置默认提示词
  ipcMain.handle(
    SYSTEM_PROMPT_IPC_CHANNELS.SET_DEFAULT,
    async (_, id: string | null): Promise<void> => {
      return setDefaultPrompt(id)
    }
  )

  // ===== GitHub Release =====

  // 获取最新 Release
  ipcMain.handle(
    GITHUB_RELEASE_IPC_CHANNELS.GET_LATEST_RELEASE,
    async (): Promise<GitHubRelease | null> => {
      return getLatestRelease()
    }
  )

  // 获取 Release 列表
  ipcMain.handle(
    GITHUB_RELEASE_IPC_CHANNELS.LIST_RELEASES,
    async (_, options?: GitHubReleaseListOptions): Promise<GitHubRelease[]> => {
      return listGitHubReleases(options)
    }
  )

  // 获取指定版本的 Release
  ipcMain.handle(
    GITHUB_RELEASE_IPC_CHANNELS.GET_RELEASE_BY_TAG,
    async (_, tag: string): Promise<GitHubRelease | null> => {
      return getReleaseByTag(tag)
    }
  )

  // ===== 本地化版本历史（Release Notes）=====
  // 版本历史读本地 resources/release-notes/*.md，完全离线可用，不依赖 GitHub 网络

  // 获取版本历史列表（semver 降序，最近 N 条）
  ipcMain.handle(
    RELEASE_NOTES_IPC_CHANNELS.LIST,
    async (): Promise<ReturnType<typeof getReleaseNotesList>> => {
      return getReleaseNotesList()
    }
  )

  // 获取最新版本号
  ipcMain.handle(
    RELEASE_NOTES_IPC_CHANNELS.LATEST,
    async (): Promise<string | undefined> => {
      return getLatestReleaseVersion()
    }
  )

  // 获取合并后的完整版本历史 Markdown
  ipcMain.handle(
    RELEASE_NOTES_IPC_CHANNELS.COMBINED,
    async (): Promise<string> => {
      return getCombinedReleaseNotes()
    }
  )

  // ===== 用户反馈（→ GitHub Issues）=====

  // 提交反馈到 GitHub Issues（含截图 user-attachments 上传，失败自动落本地草稿）
  ipcMain.handle(
    FEEDBACK_IPC_CHANNELS.SUBMIT,
    async (_event, input: FeedbackSubmitInput, appVersion?: string, platform?: string) => {
      const { submitFeedback } = await import('./lib/feedback-service')
      return submitFeedback(input, appVersion ?? '', platform ?? '')
    }
  )

  // 测试 GitHub 凭证（PAT 是否有效且有目标仓库权限）
  ipcMain.handle(
    FEEDBACK_IPC_CHANNELS.TEST_CONNECTION,
    async (_event, config: FeedbackGithubConfig) => {
      const { testFeedbackConnection } = await import('./lib/feedback-service')
      return testFeedbackConnection(config)
    }
  )

  // 读取反馈渠道配置（不返回 token 明文）
  ipcMain.handle(
    FEEDBACK_IPC_CHANNELS.GET_CONFIG,
    async () => {
      const { getFeedbackConfigPublic } = await import('./lib/feedback-service')
      return getFeedbackConfigPublic()
    }
  )

  // 保存反馈渠道配置
  ipcMain.handle(
    FEEDBACK_IPC_CHANNELS.SAVE_CONFIG,
    async (_event, config: FeedbackGithubConfig) => {
      const { saveFeedbackConfig } = await import('./lib/feedback-service')
      saveFeedbackConfig(config)
    }
  )

  // 截取当前应用窗口（renderer 会在调用前短暂隐藏反馈弹窗自身）
  ipcMain.handle(
    FEEDBACK_IPC_CHANNELS.CAPTURE_WINDOW,
    async (event) => {
      const { captureFeedbackWindow } = await import('./lib/feedback-service')
      return captureFeedbackWindow(event.sender)
    }
  )

  // 选择本地图片（压缩后返回预览 dataUrl + 提交用 filePath）
  ipcMain.handle(
    FEEDBACK_IPC_CHANNELS.PICK_IMAGES,
    async (event) => {
      const { pickFeedbackImages } = await import('./lib/feedback-service')
      return pickFeedbackImages(event.sender)
    }
  )

  // 列出本地反馈草稿（v2 可重试，v1 旧格式标记 legacy）
  ipcMain.handle(FEEDBACK_IPC_CHANNELS.LIST_DRAFTS, async () => {
    const { listFeedbackDrafts } = await import('./lib/feedback-service')
    return listFeedbackDrafts()
  })

  // 删除本地反馈草稿（按文件名）
  ipcMain.handle(FEEDBACK_IPC_CHANNELS.DELETE_DRAFT, async (_event, fileName: string) => {
    const { deleteFeedbackDraft } = await import('./lib/feedback-service')
    return deleteFeedbackDraft(fileName)
  })

  // ===== 「发现」面板（官方内容流 + 社区 + 反馈入口）=====
  registerDiscoverHandlers()

  // ===== Slack 集成 =====

  ipcMain.handle(
    SLACK_IPC_CHANNELS.GET_CONFIG,
    async (): Promise<import('@guru/shared').SlackSettingsConfig> => {
      return getSlackSettingsConfig()
    },
  )

  ipcMain.handle(
    SLACK_IPC_CHANNELS.SAVE_BOT_CONFIG,
    async (_event, input: import('@guru/shared').SlackBotConfigInput) => {
      const saved = saveSlackBotConfig(input)
      if (saved.enabled && saved.botToken && saved.appToken) {
        void slackBridgeManager.restartBot(saved.id).catch((error) => {
          console.error(`[Slack IPC] Bot "${saved.name}" 重启失败:`, redactSensitiveLogValue(error))
        })
      } else {
        void slackBridgeManager.stopBot(saved.id)
      }
      return toSlackBotSettingsConfig(saved)
    },
  )

  ipcMain.handle(
    SLACK_IPC_CHANNELS.REMOVE_BOT,
    async (_event, botId: string) => {
      await slackBridgeManager.stopBot(botId)
      return removeSlackBot(botId)
    },
  )

  ipcMain.handle(
    SLACK_IPC_CHANNELS.GET_MANIFEST,
    async (_event, options?: { botName?: string }) => {
      return buildSlackManifest(options)
    },
  )

  ipcMain.handle(
    SLACK_IPC_CHANNELS.TEST_CONNECTION,
    async (_event, botToken: string): Promise<import('@guru/shared').SlackTestResult> => {
      return slackBridgeManager.testConnection(botToken)
    },
  )

  ipcMain.handle(
    SLACK_IPC_CHANNELS.START_BOT,
    async (_event, botId: string): Promise<void> => {
      await slackBridgeManager.startBot(botId)
    },
  )

  ipcMain.handle(
    SLACK_IPC_CHANNELS.STOP_BOT,
    async (_event, botId: string): Promise<void> => {
      await slackBridgeManager.stopBot(botId)
    },
  )

  ipcMain.handle(
    SLACK_IPC_CHANNELS.GET_STATUS,
    async (): Promise<import('@guru/shared').SlackMultiBridgeState> => {
      return slackBridgeManager.getStates()
    },
  )

  // ===== 飞书集成 =====
  registerFeishuHandlers()

  // ===== 飞书扫码注册 =====
  registerFeishuQrHandlers()

  // ===== 钉钉集成 =====
  registerDingtalkHandlers()

  // ===== 微信集成 =====
  registerWechatHandlers()

  // ===== 存储管理 =====

  ipcMain.handle(STORAGE_IPC_CHANNELS.GET_STATS, async () => {
    return calculateStorageStats()
  })

  ipcMain.handle(STORAGE_IPC_CHANNELS.CLEANUP, async (_, options: CleanupOptions) => {
    return cleanupStorage(options)
  })

  ipcMain.handle(STORAGE_IPC_CHANNELS.CLEANUP_TEMP, async () => {
    return cleanupTempFiles()
  })

  ipcMain.handle(STORAGE_IPC_CHANNELS.CLEANUP_DISCOVER, async () => {
    return cleanupDiscoverCache()
  })

  ipcMain.handle(STORAGE_IPC_CHANNELS.PREVIEW_ARCHIVED_CLEANUP, async (_event, beforeDays: number) => {
    return previewArchivedCleanup(beforeDays)
  })

  ipcMain.handle(STORAGE_IPC_CHANNELS.PREVIEW_STRIP_IMAGES, async () => {
    return previewStripOversizedImages()
  })

  ipcMain.handle(STORAGE_IPC_CHANNELS.STRIP_IMAGES, async () => {
    return stripOversizedImages()
  })

  // ===== 用量统计 =====

  ipcMain.handle(USAGE_IPC_CHANNELS.GET_STATS, async (_event, range: UsageRange) => {
    return getAgentUsageStats(range ?? 'all')
  })

  // 启动时自动清理临时文件
  const runStartupCleanup = async (): Promise<void> => {
    try {
      const settings = getSettings()
      if (settings.autoCleanupTempOnStart !== false) {
        const result = await cleanupTempFiles()
        if (result.freedBytes > 0) {
          console.log(`[存储清理] 启动时清理了 ${(result.freedBytes / 1024 / 1024).toFixed(1)} MB 临时文件`)
        }
      }
      const archiveDays = settings.autoCleanupArchivedDays ?? 0
      if (archiveDays > 0) {
        const result = await cleanupStorage({
          categories: ['agent-sessions', 'sdk-config'],
          orphansOnly: false,
          archivedBeforeDays: archiveDays,
        })
        if (result.freedBytes > 0) {
          console.log(`[存储清理] 启动时清理了 ${(result.freedBytes / 1024 / 1024).toFixed(1)} MB 归档数据`)
        }
      }
    } catch (e) {
      console.error('[存储清理] 启动时清理失败:', e)
    }
  }
  runStartupCleanup()

  // ===== 快速任务窗口 =====

  // 提交快速任务 → 隐藏窗口 + 转发到主窗口（由渲染进程创建会话并发送消息）
  ipcMain.handle(
    QUICK_TASK_IPC_CHANNELS.SUBMIT,
    async (_, input: QuickTaskSubmitInput): Promise<void> => {
      const { hideQuickTaskWindow } = await import('./lib/quick-task-window')
      const { getMainWindow } = await import('./index')
      hideQuickTaskWindow()

      const mainWin = getMainWindow()
      if (mainWin && !mainWin.isDestroyed()) {
        // 转发到主窗口渲染进程，由 GlobalShortcuts 创建会话并触发发送
        mainWin.webContents.send('quick-task:open-session', {
          mode: input.mode,
          text: input.text,
          files: input.files,
        })
        mainWin.show()
        mainWin.focus()
      }
    }
  )

  // 隐藏快速任务窗口
  ipcMain.handle(
    QUICK_TASK_IPC_CHANNELS.HIDE,
    async (): Promise<void> => {
      const { hideQuickTaskWindow } = await import('./lib/quick-task-window')
      hideQuickTaskWindow()
    }
  )

  // 重新注册全局快捷键（设置中修改快捷键后调用）
  ipcMain.handle(
    QUICK_TASK_IPC_CHANNELS.REREGISTER_GLOBAL_SHORTCUTS,
    async (): Promise<Record<string, boolean>> => {
      const { reregisterAllGlobalShortcuts } = await import('./lib/global-shortcut-service')
      return reregisterAllGlobalShortcuts()
    }
  )

  // 查询系统实际接受的全局快捷键，供快捷键地图标示未注册项。
  ipcMain.handle(
    QUICK_TASK_IPC_CHANNELS.GET_GLOBAL_SHORTCUT_REGISTRATION_STATUS,
    async (): Promise<Record<string, boolean>> => {
      const { getGlobalShortcutRegistrationStatus } = await import('./lib/global-shortcut-service')
      return getGlobalShortcutRegistrationStatus()
    }
  )

  // ===== 语音输入 =====

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.GET_SETTINGS,
    async (): Promise<VoiceDictationSettings> => {
      const { getVoiceDictationSettings } = await import('./lib/voice-dictation-settings-service')
      return getVoiceDictationSettings()
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.UPDATE_SETTINGS,
    async (_, updates: VoiceDictationSettingsUpdate): Promise<VoiceDictationSettings> => {
      const { updateVoiceDictationSettings } = await import('./lib/voice-dictation-settings-service')
      return updateVoiceDictationSettings(updates)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.TEST_CONNECTION,
    async (_, updates?: VoiceDictationSettingsUpdate): Promise<VoiceDictationTestResult> => {
      const { getVoiceDictationSettings } = await import('./lib/voice-dictation-settings-service')
      const { testDoubaoAsrConnection } = await import('./lib/doubao-asr-service')
      const settings = { ...getVoiceDictationSettings(), ...(updates ?? {}) }
      return testDoubaoAsrConnection(settings)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.TOGGLE,
    async (event, input?: VoiceDictationToggleInput): Promise<void> => {
      const { toggleVoiceDictationWindow } = await import('./lib/voice-dictation-window')
      const sourceWindow = BrowserWindow.fromWebContents(event.sender)
      const sourceInputId = typeof input?.sourceInputId === 'string' && input.sourceInputId.length > 0 && input.sourceInputId.length <= 512
        ? input.sourceInputId
        : undefined
      toggleVoiceDictationWindow({ targetIsGuru: !!sourceWindow, sourceInputId })
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.START,
    async (event, input: VoiceDictationStartInput): Promise<void> => {
      const { getVoiceDictationSettings } = await import('./lib/voice-dictation-settings-service')
      const { startDoubaoAsrSession } = await import('./lib/doubao-asr-service')
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) throw new Error('语音输入窗口不存在')
      await startDoubaoAsrSession(input.sessionId, getVoiceDictationSettings(), win)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.SEND_AUDIO,
    async (_, input: VoiceDictationAudioChunkInput): Promise<void> => {
      const { sendDoubaoAsrAudio } = await import('./lib/doubao-asr-service')
      sendDoubaoAsrAudio(input.sessionId, input.data)
    }
  )

  ipcMain.on(VOICE_DICTATION_IPC_CHANNELS.REPORT_VOLUME, (event, volume: unknown) => {
    void Promise.all([
      import('./index'),
      import('./lib/voice-dictation-window'),
    ]).then(([{ getMainWindow }, { updateVoiceDictationIndicatorVolume }]) => {
      const mainWindow = getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) return
      updateVoiceDictationIndicatorVolume(typeof volume === 'number' ? volume : 0)
    }).catch(console.error)
  })

  ipcMain.on(VOICE_DICTATION_IPC_CHANNELS.REPORT_TRANSCRIPT, (event, text: unknown) => {
    void Promise.all([
      import('./index'),
      import('./lib/voice-dictation-window'),
    ]).then(([{ getMainWindow }, { updateVoiceDictationIndicatorTranscript }]) => {
      const mainWindow = getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) return
      updateVoiceDictationIndicatorTranscript(typeof text === 'string' ? text.slice(-4_000) : '')
    }).catch(console.error)
  })

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.STOP,
    async (_, input: VoiceDictationStopInput): Promise<void> => {
      const { stopDoubaoAsrSession } = await import('./lib/doubao-asr-service')
      await stopDoubaoAsrSession(input.sessionId)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.CANCEL,
    async (_, input: VoiceDictationStopInput): Promise<void> => {
      const { cancelDoubaoAsrSession } = await import('./lib/doubao-asr-service')
      const { clearVoiceDictationPreview } = await import('./lib/text-output-service')
      clearVoiceDictationPreview(
        input.previewSessionId ?? input.sessionId,
        input.targetInputId,
        input.outputContextId,
      )
      cancelDoubaoAsrSession(input.sessionId)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.PREVIEW,
    async (_, input: VoiceDictationPreviewInput): Promise<void> => {
      const { getVoiceDictationSettings } = await import('./lib/voice-dictation-settings-service')
      const { previewVoiceDictationText } = await import('./lib/text-output-service')
      previewVoiceDictationText(input, getVoiceDictationSettings())
    }
  )

  ipcMain.on(VOICE_DICTATION_IPC_CHANNELS.ACK_INSERT_TEXT, (event, input: VoiceDictationTextDeliveryInput) => {
    void Promise.all([
      import('./index'),
      import('./lib/text-output-service'),
    ]).then(([{ getMainWindow }, { acknowledgeVoiceDictationTextDelivery }]) => {
      const mainWindow = getMainWindow()
      if (!mainWindow || mainWindow.isDestroyed() || event.sender.id !== mainWindow.webContents.id) return
      if (!input || typeof input.sessionId !== 'string' || typeof input.delivered !== 'boolean') return
      acknowledgeVoiceDictationTextDelivery(input.sessionId, input.delivered)
    }).catch(console.error)
  })

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.COMMIT,
    async (_, input: VoiceDictationCommitInput): Promise<VoiceDictationCommitResult> => {
      const { getVoiceDictationSettings } = await import('./lib/voice-dictation-settings-service')
      const { commitVoiceDictationText } = await import('./lib/text-output-service')
      return commitVoiceDictationText(input, getVoiceDictationSettings())
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.HIDE,
    async (): Promise<void> => {
      const { hideVoiceDictationWindow } = await import('./lib/voice-dictation-window')
      hideVoiceDictationWindow()
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.RESIZE,
    async (_, input: VoiceDictationResizeInput): Promise<void> => {
      const { resizeVoiceDictationWindow } = await import('./lib/voice-dictation-window')
      resizeVoiceDictationWindow(input.height)
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.CHECK_MIC_PERMISSION,
    async (): Promise<MicPermissionResult> => {
      const { checkMicrophonePermission } = await import('./lib/microphone-permission-service')
      return checkMicrophonePermission()
    }
  )

  ipcMain.handle(
    VOICE_DICTATION_IPC_CHANNELS.REQUEST_MIC_PERMISSION,
    async (): Promise<MicPermissionResult> => {
      const { requestMicrophonePermission } = await import('./lib/microphone-permission-service')
      return requestMicrophonePermission()
    }
  )

  // ===== 数据迁移 =====

  ipcMain.handle('migration:open-data-folder', async (): Promise<void> => {
    const dataDir = getConfigDir()
    const error = await shell.openPath(dataDir)
    if (error) throw new Error(`无法打开 Guru 数据文件夹：${error}`)
  })

  // ===== 窗口控制（Windows 自定义标题栏按钮）=====

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_MINIMIZE,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) win.minimize()
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_MAXIMIZE,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        win.isMaximized() ? win.unmaximize() : win.maximize()
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_CLOSE,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) win.close()
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_IS_MAXIMIZED,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return win && !win.isDestroyed() ? win.isMaximized() : false
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_IS_FULLSCREEN,
    async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return win && !win.isDestroyed() ? win.isFullScreen() : false
    }
  )

  // ===== 任务 / 日程（Planning）=====
  registerPlanningHandlers()

  // ===== macOS Calendar / Reminders 同步（授权、受管目标与单向发布） =====
  const isPlanningNativeSyncEntity = (value: unknown): value is PlanningNativeSyncEntity => value === 'calendar' || value === 'reminder'
  ipcMain.handle(PLANNING_IPC_CHANNELS.GET_NATIVE_SYNC_STATUS, async (): Promise<PlanningNativeSyncStatus> => getPlanningNativeSyncStatus())
  ipcMain.handle(PLANNING_IPC_CHANNELS.REQUEST_NATIVE_SYNC_ACCESS, async (_, entity: unknown): Promise<PlanningNativeSyncPermissionResult> => {
    if (!isPlanningNativeSyncEntity(entity)) throw new Error('同步实体类型非法')
    return requestPlanningNativeSyncAccess(entity)
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.OPEN_NATIVE_SYNC_PRIVACY_SETTINGS, async (_, entity: unknown): Promise<void> => {
    if (!isPlanningNativeSyncEntity(entity)) throw new Error('同步实体类型非法')
    if (process.platform !== 'darwin') return
    await shell.openExternal(entity === 'calendar'
      ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars'
      : 'x-apple.systempreferences:com.apple.preference.security?Privacy_Reminders')
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_NATIVE_SYNC_TARGETS, async (_, entity: unknown): Promise<PlanningNativeSyncTarget[]> => {
    if (!isPlanningNativeSyncEntity(entity)) throw new Error('同步实体类型非法')
    return listPlanningNativeSyncTargets(entity)
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_NATIVE_CONNECTION_TARGETS, async (_, entity: unknown): Promise<PlanningNativeSyncTarget[]> => {
    if (!isPlanningNativeSyncEntity(entity)) throw new Error('同步实体类型非法')
    return listPlanningNativeConnectionTargets(entity)
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_NATIVE_CONNECTIONS, async (_, entity?: unknown): Promise<PlanningNativeConnection[]> => {
    if (entity !== undefined && !isPlanningNativeSyncEntity(entity)) throw new Error('同步实体类型非法')
    return listPlanningNativeConnections(entity)
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.CONNECT_NATIVE_CONNECTION, async (_, input: ConnectPlanningNativeConnectionInput): Promise<PlanningNativeConnection> => {
    if (!input || !isPlanningNativeSyncEntity(input.entity) || !input.target || typeof input.target.id !== 'string') throw new Error('连接参数非法')
    // renderer 不可信：用 EventKit 当前返回的完整目标覆盖传入元数据。
    const target = (await listPlanningNativeConnectionTargets(input.entity)).find((item) => item.id === input.target.id)
    if (!target) throw new Error('系统集合不存在或尚未授权')
    const connection = connectPlanningNativeConnection({ entity: input.entity, target })
    // 用户刚确认连接时必须立刻回流，不能被全局定期同步 cooldown 延后。
    void runPlanningNativeSync(true)
    return connection
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.DISCONNECT_NATIVE_CONNECTION, async (_, id: unknown): Promise<boolean> => {
    if (typeof id !== 'string' || !id) throw new Error('连接 id 非法')
    const disconnected = disconnectPlanningNativeConnection(id)
    if (disconnected) broadcastPlanningChanged(['todos', 'calendar_events'])
    return disconnected
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_NATIVE_SYNC_CONFLICTS, async (): Promise<PlanningNativeSyncConflict[]> => listPlanningNativeSyncConflicts())
  ipcMain.handle(PLANNING_IPC_CHANNELS.RESOLVE_NATIVE_SYNC_CONFLICT, async (_, input: ResolvePlanningNativeSyncConflictInput): Promise<boolean> => {
    if (!input || typeof input.id !== 'string' || !['keep_guru', 'keep_system'].includes(input.resolution)) throw new Error('冲突解决参数非法')
    const resolved = resolvePlanningNativeSyncConflict(input)
    if (resolved) { broadcastPlanningChanged(['todos', 'calendar_events']); void runPlanningNativeSync(true) }
    return resolved
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_SYNC_PROFILES, async (): Promise<PlanningSyncProfile[]> => listPlanningSyncProfiles())
  ipcMain.handle(PLANNING_IPC_CHANNELS.SAVE_SYNC_PROFILE, async (_, input: SavePlanningSyncProfileInput): Promise<PlanningSyncProfile> => {
    if (!input || !isPlanningNativeSyncEntity(input.entity) || !input.target || typeof input.target.id !== 'string' || typeof input.target.title !== 'string' || typeof input.target.sourceTitle !== 'string' || (input.enabled !== undefined && typeof input.enabled !== 'boolean')) throw new Error('同步目标参数非法')
    // renderer 不可信：必须由主进程重新确认目标仍存在且可写，不能接受伪造的 Calendar/List 标识。
    const target = (await listPlanningNativeSyncTargets(input.entity)).find((item) => item.id === input.target.id)
    if (!target) throw new Error('同步目标不存在、不可写或尚未授权')
    const profile = savePlanningSyncProfile({ ...input, target })
    // 受管 Calendar 的系统存量也必须立即回流；不能被 30 秒 reconcile 冷却窗口延后。
    void runPlanningNativeSync(true)
    return profile
  })

  // ===== 定时任务（Automation）=====
  registerAutomationHandlers()

  // ===== Agent 专家包 =====

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.LIST,
    async (): Promise<ExpertPackage[]> => listExperts(getExpertsDir()),
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.GET,
    async (_, id: string): Promise<ExpertPackage | null> => {
      if (!isNonEmptyString(id)) throw new Error('id 必填')
      return getExpert(getExpertsDir(), id)
    },
  )
  // ===== 用户授权的 Markdown Vault =====
  registerVaultHandlers()

  // ===== Agent 专家团（team.json 新结构） =====

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.TEAMS_LIST,
    async (): Promise<TeamSquad[]> => listTeams(getExpertsDir()),
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.TEAMS_GET,
    async (_, id: string): Promise<TeamSquad | null> => {
      if (!isNonEmptyString(id)) throw new Error('id 必填')
      return getTeam(getExpertsDir(), id)
    },
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.TEAMS_CREATE,
    async (_, input: CreateTeamInput): Promise<TeamSquad> => {
      if (!input || typeof input !== 'object') throw new Error('input 必须是对象')
      if (!isNonEmptyString(input.id)) throw new Error('id 必填')
      if (!isNonEmptyString(input.label)) throw new Error('label 必填')
      if (!isNonEmptyString(input.leaderExpertId)) throw new Error('leaderExpertId 必填')
      return createTeam(getExpertsDir(), input)
    },
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.TEAMS_UPDATE,
    async (_, id: string, patch: UpdateTeamInput): Promise<TeamSquad> => {
      if (!isNonEmptyString(id)) throw new Error('id 必填')
      if (!patch || typeof patch !== 'object') throw new Error('patch 必须是对象')
      return updateTeam(getExpertsDir(), id, patch)
    },
  )

  ipcMain.handle(
    EXPERT_IPC_CHANNELS.TEMPLATES_LIST,
    async (): Promise<ExpertTemplate[]> => {
      const templatesDir = getDefaultExpertTemplatesDir()
      if (!existsSync(templatesDir)) return []
      const templates: ExpertTemplate[] = []
      for (const entry of readdirSync(templatesDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        try {
          const parsed = JSON.parse(readFileSync(join(templatesDir, entry.name), 'utf-8'))
          if (typeof parsed?.slug !== 'string') continue
          templates.push({
            slug: parsed.slug,
            name: typeof parsed.name === 'string' ? parsed.name : parsed.slug,
            description: typeof parsed.description === 'string' ? parsed.description : '',
            category: typeof parsed.category === 'string' ? parsed.category : '',
            icon: typeof parsed.icon === 'string' ? parsed.icon : '',
            accent: typeof parsed.accent === 'string' ? parsed.accent : '',
            instructions: typeof parsed.instructions === 'string' ? parsed.instructions : '',
            skills: Array.isArray(parsed.skills) ? parsed.skills.filter((s: unknown): s is string => typeof s === 'string') : [],
          })
        } catch (error) {
          console.warn(`[专家] 跳过损坏的专家模板 ${entry.name}:`, error)
          // 损坏文件改名备份，避免每次启动重复解析失败，也保留用户数据恢复的可能
          try {
            renameSync(join(templatesDir, entry.name), join(templatesDir, `${entry.name}.corrupt-${Date.now()}.bak`))
          } catch { /* 备份失败不阻断列表 */ }
          continue
        }
      }
      return templates.sort((a, b) => a.slug.localeCompare(b.slug))
    },
  )
}
