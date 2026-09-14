/**
 * planning-handlers — 从 src/main/ipc.ts 抽出的 IPC 处理器分组
 *
 * 抽取自 ipc.ts banner「任务 / 日程」（2026-09-14 分批拆分）。整块搬移，未改 handler 逻辑。
 */

import { createAgentSession } from '../lib/agent-session-manager'
import { broadcastPlanningChanged } from '../lib/planning-events'
import { acknowledgePlanningReminder, createCalendarEvent, createPlanningGroup, createTodo, deleteCalendarEvent, deletePlanningGroup, deleteTodo, getTodo, listActivePlanningReminders, listCalendarEvents, listPlanningGroups, listPlanningTags, listTodos, snoozePlanningReminder, touchTodoSession, updateCalendarEvent, updatePlanningGroup, updateTodo } from '../lib/planning-manager'
import { getSettings } from '../lib/settings-service'
import { applyWindowZoomIn, applyWindowZoomOut } from '../lib/window-zoom'
import { IPC_CHANNELS, PLANNING_IPC_CHANNELS } from '@guru/shared'
import type { ActivePlanningReminder, CalendarEvent, CalendarEventListQuery, CreateCalendarEventInput, CreatePlanningGroupInput, CreateTodoInput, PlanningGroup, PlanningGroupScope, PlanningReminder, PlanningTag, SnoozePlanningReminderInput, StartTodoAgentInput, StartTodoAgentResult, Todo, TodoAgentSessionActivation, TodoListQuery, UpdateCalendarEventInput, UpdatePlanningGroupInput, UpdateTodoInput, PlanningWorkspaceScope } from '@guru/shared'
import { BrowserWindow, ipcMain } from 'electron'

export function registerPlanningHandlers(): void {
  // ===== 任务 / 日程（Planning）=====

  const isPlanningTitle = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 500
  const isPlanningTimestamp = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
  const isTodoPriority = (value: unknown): value is 'low' | 'medium' | 'high' =>
    value === 'low' || value === 'medium' || value === 'high'
  const isTodoStatus = (value: unknown): value is 'open' | 'completed' =>
    value === 'open' || value === 'completed'
  const parseTodoListQuery = (input: unknown): TodoListQuery => {
    if (input === undefined) return {}
    if (!input || typeof input !== 'object') throw new Error('Todo 查询参数非法')
    const query = input as TodoListQuery
    if (query.status !== undefined && !isTodoStatus(query.status)) throw new Error('Todo status 非法')
    if (query.dueBefore !== undefined && !isPlanningTimestamp(query.dueBefore)) throw new Error('Todo dueBefore 非法')
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) throw new Error('Todo limit 非法')
    return query
  }
  const parseCalendarEventListQuery = (input: unknown): CalendarEventListQuery => {
    if (input === undefined) return {}
    if (!input || typeof input !== 'object') throw new Error('日程查询参数非法')
    const query = input as CalendarEventListQuery
    if (query.from !== undefined && !isPlanningTimestamp(query.from)) throw new Error('日程 from 非法')
    if (query.to !== undefined && !isPlanningTimestamp(query.to)) throw new Error('日程 to 非法')
    if (query.from !== undefined && query.to !== undefined && query.from > query.to) throw new Error('日程范围非法')
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) throw new Error('日程 limit 非法')
    return query
  }

  ipcMain.handle(PLANNING_IPC_CHANNELS.OPEN_WINDOW, async (): Promise<void> => {
    const { showPlanningWindow } = await import('../lib/planning-window')
    showPlanningWindow()
  })

  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_TODOS, async (_, scope?: PlanningWorkspaceScope, workspaceId?: string): Promise<Todo[]> =>
    listTodos(scope === 'all' ? {} : { workspaceId: workspaceId ?? getSettings().agentWorkspaceId ?? '' }))
  ipcMain.handle(PLANNING_IPC_CHANNELS.CREATE_TODO, async (_, input: CreateTodoInput): Promise<Todo> => {
    if (!input || !isPlanningTitle(input.title)) throw new Error('Todo 标题不能为空且不能超过 500 字')
    if (input.priority !== undefined && !isTodoPriority(input.priority)) throw new Error('Todo priority 非法')
    if (input.dueAt !== undefined && !isPlanningTimestamp(input.dueAt)) throw new Error('Todo dueAt 非法')
    if (input.sessionId !== undefined && (typeof input.sessionId !== 'string' || !input.sessionId.trim())) throw new Error('Todo sessionId 非法')
    const todo = createTodo(input)
    broadcastPlanningChanged(['todos', 'reminders'])
    return todo
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.START_TODO_AGENT, async (event, input: StartTodoAgentInput): Promise<StartTodoAgentResult> => {
    if (!input || typeof input.todoId !== 'string' || !input.todoId) throw new Error('Todo id 必填')
    if (typeof input.workspaceId !== 'string' || !input.workspaceId) throw new Error('workspaceId 必填')
    if (typeof input.channelId !== 'string' || !input.channelId) throw new Error('channelId 必填')
    if (!isPlanningTimestamp(input.expectedUpdatedAt)) throw new Error('Todo expectedUpdatedAt 非法')
    const todo = getTodo(input.todoId)
    if (!todo) throw new Error('Todo 不存在')
    if (todo.updatedAt !== input.expectedUpdatedAt) throw new Error('Todo 已被修改，请刷新后重试')
    const session = createAgentSession(
      `处理：${todo.title}`,
      input.channelId,
      input.workspaceId,
      input.modelId,
      undefined,
    )
    touchTodoSession(todo.id, session.id)
    broadcastPlanningChanged(['todos'])

    // 独立规划窗口没有 AgentView，需由主窗口接手打开会话并消费自动启动提示。
    try {
      const sourceWindowKind = new URL(event.sender.getURL()).searchParams.get('window')
      if (sourceWindowKind === 'planning') {
        const mainWindow = BrowserWindow.getAllWindows().find((win) => {
          if (win.isDestroyed() || win.webContents.id === event.sender.id) return false
          return new URL(win.webContents.getURL()).searchParams.get('window') === null
        })
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
          const activation: TodoAgentSessionActivation = { todo: getTodo(todo.id) ?? todo, session }
          mainWindow.webContents.send(PLANNING_IPC_CHANNELS.TODO_AGENT_SESSION_READY, activation)
        }
      }
    } catch (error) {
      console.error('[任务/日程] 转交 Todo Agent 会话到主窗口失败:', error)
    }

    return { todo: getTodo(todo.id) ?? todo, session }
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.UPDATE_TODO, async (_, input: UpdateTodoInput): Promise<Todo | undefined> => {
    if (!input || typeof input.id !== 'string' || !input.id) throw new Error('Todo id 必填')
    if (input.title !== undefined && !isPlanningTitle(input.title)) throw new Error('Todo 标题不能为空且不能超过 500 字')
    if (input.priority !== undefined && !isTodoPriority(input.priority)) throw new Error('Todo priority 非法')
    if (input.status !== undefined && !isTodoStatus(input.status)) throw new Error('Todo status 非法')
    if (input.dueAt !== undefined && input.dueAt !== null && !isPlanningTimestamp(input.dueAt)) throw new Error('Todo dueAt 非法')
    if (input.expectedUpdatedAt !== undefined && !isPlanningTimestamp(input.expectedUpdatedAt)) throw new Error('Todo expectedUpdatedAt 非法')
    const todo = updateTodo(input)
    if (todo) broadcastPlanningChanged(['todos', 'reminders'])
    return todo
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.DELETE_TODO, async (_, id: string): Promise<boolean> => {
    if (!id || typeof id !== 'string') throw new Error('Todo id 必填')
    const deleted = deleteTodo(id)
    if (deleted) broadcastPlanningChanged(['todos', 'calendar_events', 'reminders'])
    return deleted
  })

  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_CALENDAR_EVENTS, async (_, scope?: PlanningWorkspaceScope, workspaceId?: string): Promise<CalendarEvent[]> =>
    listCalendarEvents(scope === 'all' ? {} : { workspaceId: workspaceId ?? getSettings().agentWorkspaceId ?? '' }))
  ipcMain.handle(PLANNING_IPC_CHANNELS.CREATE_CALENDAR_EVENT, async (_, input: CreateCalendarEventInput): Promise<CalendarEvent> => {
    if (!input || !isPlanningTitle(input.title) || !isPlanningTimestamp(input.startAt)) throw new Error('日程标题和 startAt 必填')
    if (input.endAt !== undefined && (!isPlanningTimestamp(input.endAt) || input.endAt < input.startAt)) throw new Error('日程 endAt 非法')
    const event = createCalendarEvent(input)
    broadcastPlanningChanged(['calendar_events', 'reminders'])
    return event
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.UPDATE_CALENDAR_EVENT, async (_, input: UpdateCalendarEventInput): Promise<CalendarEvent | undefined> => {
    if (!input || typeof input.id !== 'string' || !input.id) throw new Error('日程 id 必填')
    if (input.title !== undefined && !isPlanningTitle(input.title)) throw new Error('日程标题不能为空且不能超过 500 字')
    if (input.startAt !== undefined && !isPlanningTimestamp(input.startAt)) throw new Error('日程 startAt 非法')
    if (input.endAt !== undefined && input.endAt !== null && !isPlanningTimestamp(input.endAt)) throw new Error('日程 endAt 非法')
    if (input.expectedUpdatedAt !== undefined && !isPlanningTimestamp(input.expectedUpdatedAt)) throw new Error('日程 expectedUpdatedAt 非法')
    const event = updateCalendarEvent(input)
    if (event) broadcastPlanningChanged(['calendar_events', 'reminders'])
    return event
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.DELETE_CALENDAR_EVENT, async (_, id: string): Promise<boolean> => {
    if (!id || typeof id !== 'string') throw new Error('日程 id 必填')
    const deleted = deleteCalendarEvent(id)
    if (deleted) broadcastPlanningChanged(['calendar_events', 'reminders'])
    return deleted
  })

  const isPlanningShortName = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 100
  const isPlanningGroupScope = (value: unknown): value is PlanningGroupScope => value === 'todo' || value === 'calendar'
  const isOptionalColor = (value: unknown): boolean => value === undefined || value === null || typeof value === 'string'

  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_GROUPS, async (_, scope: PlanningGroupScope): Promise<PlanningGroup[]> => {
    if (!isPlanningGroupScope(scope)) throw new Error('分组范围非法')
    return listPlanningGroups(scope)
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.CREATE_GROUP, async (_, input: CreatePlanningGroupInput): Promise<PlanningGroup> => {
    if (!input || !isPlanningGroupScope(input.scope) || !isPlanningShortName(input.name) || !isOptionalColor(input.color)) throw new Error('分组参数非法')
    const group = createPlanningGroup(input); broadcastPlanningChanged(input.scope === 'todo' ? ['todo_groups', 'todos', 'reminders'] : ['calendar_groups', 'calendar_events', 'reminders']); return group
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.UPDATE_GROUP, async (_, input: UpdatePlanningGroupInput): Promise<PlanningGroup | undefined> => {
    if (!input || !isPlanningGroupScope(input.scope) || typeof input.id !== 'string' || (input.name !== undefined && !isPlanningShortName(input.name)) || !isOptionalColor(input.color)) throw new Error('分组参数非法')
    const group = updatePlanningGroup(input); if (group) broadcastPlanningChanged(input.scope === 'todo' ? ['todo_groups', 'todos', 'reminders'] : ['calendar_groups', 'calendar_events', 'reminders']); return group
  })
  ipcMain.handle(PLANNING_IPC_CHANNELS.DELETE_GROUP, async (_, scope: PlanningGroupScope, id: string): Promise<boolean> => {
    if (!isPlanningGroupScope(scope) || !id || typeof id !== 'string') throw new Error('分组参数非法')
    const deleted = deletePlanningGroup(scope, id); if (deleted) broadcastPlanningChanged(scope === 'todo' ? ['todo_groups', 'todos', 'reminders'] : ['calendar_groups', 'calendar_events', 'reminders']); return deleted
  })

  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_TAGS, async (): Promise<PlanningTag[]> => listPlanningTags())

  ipcMain.handle(PLANNING_IPC_CHANNELS.LIST_ACTIVE_REMINDERS, async (): Promise<ActivePlanningReminder[]> => listActivePlanningReminders())
  ipcMain.handle(PLANNING_IPC_CHANNELS.ACKNOWLEDGE_REMINDER, async (_, id: string): Promise<PlanningReminder | undefined> => {
    if (!id || typeof id !== 'string') throw new Error('提醒 id 必填')
    const reminder = acknowledgePlanningReminder(id); if (reminder) broadcastPlanningChanged(['todos', 'calendar_events', 'reminders']); return reminder
  })

  ipcMain.handle(
    IPC_CHANNELS.WINDOW_GET_ZOOM_FACTOR,
    async (event) => event.sender.getZoomFactor(),
  )

  // 渲染进程滚轮缩放请求（Ctrl/⌘+滚轮）：按 delta 方向缩放并广播新系数
  ipcMain.on(IPC_CHANNELS.WINDOW_ZOOM_BY_DELTA, (event, delta: unknown) => {
    if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0) return
    const wc = event.sender
    const win = BrowserWindow.fromWebContents(wc)
    if (!win || win.isDestroyed()) return
    if (delta > 0) applyWindowZoomIn(win)
    else applyWindowZoomOut(win)
  })

  ipcMain.handle(PLANNING_IPC_CHANNELS.SNOOZE_REMINDER, async (_, input: SnoozePlanningReminderInput): Promise<PlanningReminder | undefined> => {
    if (!input || typeof input.id !== 'string' || !Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 10080) throw new Error('推迟分钟数非法')
    const reminder = snoozePlanningReminder(input.id, input.minutes); if (reminder) broadcastPlanningChanged(['todos', 'calendar_events', 'reminders']); return reminder
  })
}
