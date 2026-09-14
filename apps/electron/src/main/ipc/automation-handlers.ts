/**
 * automation-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「定时任务」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { createAutomation, deleteAutomation, getAutomation, getEffectiveAutomationScheduleFields, listAutomations, updateAutomation, validateExplicitAutomationScheduleFields } from '../lib/automation-manager'
import { broadcastChanged as broadcastAutomationsChanged, runAutomationNow } from '../lib/automation-scheduler'
import { getSettings } from '../lib/settings-service'
import { isNonEmptyString } from './validators'
import { AUTOMATION_IPC_CHANNELS } from '@guru/shared'
import type { Automation, CreateAutomationInput, UpdateAutomationInput, PlanningWorkspaceScope } from '@guru/shared'
import { ipcMain } from 'electron'

export function registerAutomationHandlers(): void {
  // ===== 定时任务（Automation）=====

  // 渲染进程可能被注入内容污染（XSS via markdown / MCP tool output），主进程必须自己校验入参，
  // 否则 NaN / -Infinity / 越界值会污染 ~/.guru/automations.json，无法回滚。
  const isNonBlankString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
  const isFiniteInt = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)
  const validScheduleType = (v: unknown): v is 'interval' | 'daily' | 'weekly' | 'monthly' | 'once' =>
    v === 'interval' || v === 'daily' || v === 'weekly' || v === 'monthly' || v === 'once'
  const validPermissionMode = (v: unknown): v is 'bypassPermissions' =>
    v === 'bypassPermissions'
  const validAutomationNotificationTrigger = (v: unknown): v is 'always' | 'success' | 'error' =>
    v === 'always' || v === 'success' || v === 'error'
  const validTimeOfDay = (v: unknown): boolean => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)

  const validateAutomationNotificationTargets = (targets: unknown): void => {
    if (targets === undefined) return
    if (!Array.isArray(targets)) throw new Error('notificationTargets 必须是数组')
    if (targets.length > 5) throw new Error('notificationTargets 最多 5 个')

    for (const target of targets) {
      if (!target || typeof target !== 'object') throw new Error('notificationTargets 包含非法目标')
      const t = target as Record<string, unknown>
      if (t.type !== 'feishu') throw new Error(`不支持的通知目标: ${String(t.type)}`)
      if (typeof t.enabled !== 'boolean') throw new Error('notificationTargets.enabled 必须是 boolean')
      if (!validAutomationNotificationTrigger(t.trigger)) {
        throw new Error(`非法的 notificationTargets.trigger: ${String(t.trigger)}`)
      }
      if (!isNonEmptyString(t.botId)) throw new Error('notificationTargets.botId 必填')
      if (!isNonEmptyString(t.chatId)) throw new Error('notificationTargets.chatId 必填')
    }
  }

  const validateAutomationFields = (i: Partial<UpdateAutomationInput>): void => {
    if (i.scheduleType !== undefined && !validScheduleType(i.scheduleType)) {
      throw new Error(`非法的 scheduleType: ${String(i.scheduleType)}`)
    }
    if (i.intervalMinutes !== undefined && (!isFiniteInt(i.intervalMinutes) || i.intervalMinutes < 1)) {
      throw new Error(`非法的 intervalMinutes: ${String(i.intervalMinutes)}`)
    }
    if (i.timeOfDay !== undefined && !validTimeOfDay(i.timeOfDay)) {
      throw new Error(`非法的 timeOfDay: ${String(i.timeOfDay)}`)
    }
    if (i.activeWindowStart !== undefined && i.activeWindowStart !== null && !validTimeOfDay(i.activeWindowStart)) {
      throw new Error(`非法的 activeWindowStart: ${String(i.activeWindowStart)}`)
    }
    if (i.activeWindowEnd !== undefined && i.activeWindowEnd !== null && !validTimeOfDay(i.activeWindowEnd)) {
      throw new Error(`非法的 activeWindowEnd: ${String(i.activeWindowEnd)}`)
    }
    if (i.activeWeekdays !== undefined && i.activeWeekdays !== null && (!Array.isArray(i.activeWeekdays) || i.activeWeekdays.some((day) => !isFiniteInt(day) || day < 0 || day > 6))) {
      throw new Error(`非法的 activeWeekdays: ${String(i.activeWeekdays)}`)
    }
    if (i.dayOfWeek !== undefined && (!isFiniteInt(i.dayOfWeek) || i.dayOfWeek < 0 || i.dayOfWeek > 6)) {
      throw new Error(`非法的 dayOfWeek: ${String(i.dayOfWeek)}`)
    }
    if (i.dayOfMonth !== undefined && (!isFiniteInt(i.dayOfMonth) || i.dayOfMonth < 1 || i.dayOfMonth > 31)) {
      throw new Error(`非法的 dayOfMonth: ${String(i.dayOfMonth)}`)
    }
    if (i.scheduledAt !== undefined && (typeof i.scheduledAt !== 'number' || !Number.isFinite(i.scheduledAt) || i.scheduledAt <= 0)) {
      throw new Error(`非法的 scheduledAt: ${String(i.scheduledAt)}`)
    }
    if (i.maxRuns !== undefined && i.maxRuns !== null && (!isFiniteInt(i.maxRuns) || i.maxRuns < 1)) {
      throw new Error(`非法的 maxRuns: ${String(i.maxRuns)}`)
    }
    // agentRuntime 字段已随 Claude runtime 退役移除。
    if (i.permissionMode !== undefined && !validPermissionMode(i.permissionMode)) {
      throw new Error(`非法的 permissionMode: ${String(i.permissionMode)}`)
    }
    if (i.sessionMode !== undefined && i.sessionMode !== 'daily' && i.sessionMode !== 'reuse') {
      throw new Error(`非法的 sessionMode: ${String(i.sessionMode)}`)
    }
    validateAutomationNotificationTargets(i.notificationTargets)
  }

  const validateAutomationScheduleComplete = (
    input: Partial<UpdateAutomationInput>,
    existing?: Automation,
  ): void => {
    const scheduleType = input.scheduleType ?? existing?.scheduleType
    if (!scheduleType) throw new Error('scheduleType 必填')
    validateExplicitAutomationScheduleFields(input, scheduleType)
    const effective = getEffectiveAutomationScheduleFields(input, existing)
    if (effective.scheduleType === 'interval') {
      if (!isFiniteInt(effective.intervalMinutes) || effective.intervalMinutes < 1) throw new Error('scheduleType=interval 时 intervalMinutes 必填')
    }
    if ((effective.activeWindowStart === undefined) !== (effective.activeWindowEnd === undefined)) {
      throw new Error('activeWindowStart 与 activeWindowEnd 必须同时设置或同时清除')
    }
    if (effective.activeWeekdays !== undefined && effective.activeWeekdays.length > 0 && effective.scheduleType !== 'interval') {
      throw new Error('周内运行日限制仅支持 scheduleType=interval')
    }
    if (effective.activeWindowStart !== undefined && effective.activeWindowEnd !== undefined) {
      if (effective.scheduleType !== 'interval') throw new Error('每日执行窗口仅支持 scheduleType=interval')
      if (!validTimeOfDay(effective.activeWindowStart) || !validTimeOfDay(effective.activeWindowEnd) || effective.activeWindowStart >= effective.activeWindowEnd) {
        throw new Error('每日执行窗口必须是同一天内有效的 HH:MM 范围，且开始早于结束')
      }
    }
    if (effective.scheduleType === 'daily' || effective.scheduleType === 'weekly' || effective.scheduleType === 'monthly') {
      if (!validTimeOfDay(effective.timeOfDay)) throw new Error('scheduleType=daily/weekly/monthly 时 timeOfDay 必填')
    }
    if (effective.scheduleType === 'weekly' && !isFiniteInt(effective.dayOfWeek)) {
      throw new Error('scheduleType=weekly 时 dayOfWeek 必填')
    }
    if (effective.scheduleType === 'monthly' && !isFiniteInt(effective.dayOfMonth)) {
      throw new Error('scheduleType=monthly 时 dayOfMonth 必填')
    }
    if (effective.scheduleType === 'once' && (typeof effective.scheduledAt !== 'number' || !Number.isFinite(effective.scheduledAt) || effective.scheduledAt <= 0)) {
      throw new Error('scheduleType=once 时 scheduledAt 必填')
    }
  }

  ipcMain.handle(
    AUTOMATION_IPC_CHANNELS.LIST,
    async (_, scope?: PlanningWorkspaceScope, workspaceId?: string): Promise<Automation[]> =>
      listAutomations(scope === 'all' ? undefined : (workspaceId ?? getSettings().agentWorkspaceId ?? ''))
  )

  ipcMain.handle(
    AUTOMATION_IPC_CHANNELS.CREATE,
    async (_, input: CreateAutomationInput): Promise<Automation> => {
      if (!input || typeof input !== 'object') throw new Error('input 必须是对象')
      if (!isNonEmptyString(input.name)) throw new Error('name 必填')
      if (!isNonEmptyString(input.prompt)) throw new Error('prompt 必填')
      // channelId / workspaceId 允许为空（草稿态），但此时任务不能被启用
      validateAutomationFields(input)
      validateAutomationScheduleComplete(input)
      const a = createAutomation(input)
      broadcastAutomationsChanged()
      return a
    }
  )

  ipcMain.handle(
    AUTOMATION_IPC_CHANNELS.UPDATE,
    async (_, input: UpdateAutomationInput): Promise<Automation | undefined> => {
      if (!input || typeof input !== 'object') throw new Error('input 必须是对象')
      if (!isNonEmptyString(input.id)) throw new Error('id 必填')
      if (input.name !== undefined && !isNonBlankString(input.name)) throw new Error('name 不能为空')
      if (input.prompt !== undefined && !isNonBlankString(input.prompt)) throw new Error('prompt 不能为空')
      const existing = getAutomation(input.id)
      if (!existing) return undefined
      validateAutomationFields(input)
      validateAutomationScheduleComplete(input, existing)
      const a = updateAutomation(input)
      broadcastAutomationsChanged()
      return a
    }
  )

  ipcMain.handle(
    AUTOMATION_IPC_CHANNELS.DELETE,
    async (_, id: string): Promise<boolean> => {
      if (!isNonEmptyString(id)) throw new Error('id 必填')
      const ok = deleteAutomation(id)
      broadcastAutomationsChanged()
      return ok
    }
  )

  ipcMain.handle(
    AUTOMATION_IPC_CHANNELS.TOGGLE,
    async (_, id: string, active: boolean): Promise<Automation | undefined> => {
      if (!isNonEmptyString(id)) throw new Error('id 必填')
      if (typeof active !== 'boolean') throw new Error('active 必须是 boolean')
      const a = updateAutomation({ id, active })
      broadcastAutomationsChanged()
      return a
    }
  )

  ipcMain.handle(
    AUTOMATION_IPC_CHANNELS.RUN_NOW,
    async (_, id: string): Promise<void> => {
      if (!isNonEmptyString(id)) throw new Error('id 必填')
      await runAutomationNow(id)
    }
  )
}
