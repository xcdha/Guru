/**
 * calendar-sync-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「macOS Calendar」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { broadcastPlanningChanged } from '../lib/planning-events'
import { connectPlanningNativeConnection, disconnectPlanningNativeConnection, listPlanningNativeConnections, listPlanningNativeSyncConflicts, listPlanningSyncProfiles, resolvePlanningNativeSyncConflict, savePlanningSyncProfile } from '../lib/planning-manager'
import { runPlanningNativeSync } from '../lib/planning-native-sync-coordinator'
import { getPlanningNativeSyncStatus, listPlanningNativeConnectionTargets, listPlanningNativeSyncTargets, requestPlanningNativeSyncAccess } from '../lib/planning-native-sync-service'
import { PLANNING_IPC_CHANNELS } from '@guru/shared'
import type { ConnectPlanningNativeConnectionInput, PlanningNativeConnection, PlanningNativeSyncConflict, PlanningNativeSyncEntity, PlanningNativeSyncPermissionResult, PlanningNativeSyncStatus, PlanningNativeSyncTarget, PlanningSyncProfile, ResolvePlanningNativeSyncConflictInput, SavePlanningSyncProfileInput } from '@guru/shared'
import { ipcMain, shell } from 'electron'

export function registerCalendarSyncHandlers(): void {
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
}
