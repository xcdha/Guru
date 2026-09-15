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
import { registerAgentExpertTeamHandlers } from './ipc/agent-expert-team-handlers'
import { registerChatToolHandlers } from './ipc/chat-tool-handlers'
import { registerThirdPartyInstallHandlers } from './ipc/third-party-install-handlers'
import { registerRepoMapHandlers } from './ipc/repo-map-handlers'
import { registerAgentQueueHandlers } from './ipc/agent-queue-handlers'
import { registerWindowControlHandlers } from './ipc/window-control-handlers'
import { registerSkillFileHandlers } from './ipc/skill-file-handlers'
import { registerSystemPromptHandlers } from './ipc/system-prompt-handlers'
import { registerQuickTaskHandlers } from './ipc/quick-task-handlers'
import { registerCalendarSyncHandlers } from './ipc/calendar-sync-handlers'
import { registerSlackHandlers } from './ipc/slack-handlers'
import { registerFeedbackHandlers } from './ipc/feedback-handlers'
import { registerVoiceInputHandlers } from './ipc/voice-input-handlers'
import { registerWorkspaceCapabilityHandlers } from './ipc/workspace-capability-handlers'
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
  registerThirdPartyInstallHandlers()

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
  registerWorkspaceCapabilityHandlers()

  // ===== 项目级 Skills / MCP（嵌套 Project 可选覆盖工作区级，不影响上述工作区级通道） =====
  registerProjectSkillMcpHandlers()

  // ===== Skill 子文件管理 =====
  registerSkillFileHandlers()

  // ===== 工作区记忆文件管理 =====
  registerWorkspaceMemoryHandlers()

  // ===== Agent 队列消息 =====
  registerAgentQueueHandlers()

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
  registerChatToolHandlers()

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
  registerRepoMapHandlers()

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
  registerSystemPromptHandlers()

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
  registerFeedbackHandlers()

  // ===== 「发现」面板（官方内容流 + 社区 + 反馈入口）=====
  registerDiscoverHandlers()

  // ===== Slack 集成 =====
  registerSlackHandlers()

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
  registerQuickTaskHandlers()

  // ===== 语音输入 =====
  registerVoiceInputHandlers()

  // ===== 数据迁移 =====

  ipcMain.handle('migration:open-data-folder', async (): Promise<void> => {
    const dataDir = getConfigDir()
    const error = await shell.openPath(dataDir)
    if (error) throw new Error(`无法打开 Guru 数据文件夹：${error}`)
  })

  // ===== 窗口控制（Windows 自定义标题栏按钮）=====
  registerWindowControlHandlers()

  // ===== 任务 / 日程（Planning）=====
  registerPlanningHandlers()

  // ===== macOS Calendar / Reminders 同步（授权、受管目标与单向发布） =====
  registerCalendarSyncHandlers()

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
  registerAgentExpertTeamHandlers()
}
