import { atom } from 'jotai'

/** localStorage 持久化 key：委派活动（重启后恢复，保证重启前后内容一致） */
const DELEGATION_ACTIVITY_STORAGE_KEY = 'guru-delegation-activities'
/** 持久化保留的最大委派数（超出时丢弃最老的，防止 localStorage 无限膨胀） */
const MAX_PERSISTED_DELEGATIONS = 60

function persistDelegationActivities(map: Map<string, DelegationActivity[]>): void {
  try {
    const obj: Record<string, DelegationActivity[]> = {}
    // 只保留最近的 MAX_PERSISTED_DELEGATIONS 个委派（按最后活动时间排序）
    const entries = [...map.entries()].sort((a, b) => {
      const at = a[1][a[1].length - 1]?.ts ?? 0
      const bt = b[1][b[1].length - 1]?.ts ?? 0
      return bt - at
    })
    for (const [id, list] of entries.slice(0, MAX_PERSISTED_DELEGATIONS)) {
      obj[id] = list.slice(-30)
    }
    localStorage.setItem(DELEGATION_ACTIVITY_STORAGE_KEY, JSON.stringify(obj))
  } catch {
    // localStorage 满或不可用：静默失败，仅影响重启恢复
  }
}

function loadPersistedDelegationActivities(): Map<string, DelegationActivity[]> {
  try {
    const raw = localStorage.getItem(DELEGATION_ACTIVITY_STORAGE_KEY)
    if (!raw) return new Map()
    const obj = JSON.parse(raw) as Record<string, DelegationActivity[]>
    return new Map(Object.entries(obj))
  } catch {
    return new Map()
  }
}

/**
 * 工具流式输出：toolUseId → 当前已推送的最新输出片段。
 * SDK 通过 onUpdate → tool_execution_update → tool_progress(partial_result) 推送，
 * 渲染层用它做工具执行中的增量显示；工具完成后由最终 tool_result 接管。
 */
export const toolStreamOutputAtom = atom<Map<string, string>>(new Map())

/** 子 Agent（协作委派）实时活动条目 */
export interface DelegationActivity {
  delegationId: string
  /** 活动序号（追加排序用） */
  seq: number
  ts: number
  phase: 'tool_start' | 'tool_result' | 'assistant' | 'final'
  /** 子会话中工具的 toolUseId（tool_start/tool_result 配对用） */
  toolUseId?: string
  toolName?: string
  brief?: string
  isError?: boolean
  text?: string
  /** 工具输出内容（tool_result 时携带，供展开查看） */
  result?: string
  /** 子 Agent 标题（批量委派时用于分组展示） */
  title?: string
  /** 子 Agent 角色 */
  role?: string
  /** 父会话中委派工具的 toolUseId（渲染层按它关联活动 UI） */
  parentToolUseId?: string
}

/** 每个委派的最新活动列表（保留最近 30 条）——持久化到 localStorage，重启后恢复 */
export const delegationActivityAtom = atom<Map<string, DelegationActivity[]>>(loadPersistedDelegationActivities())

/** 供 store.set(delegationActivityAtom, next) 之后调用，把最新 map 写入 localStorage */
export function persistDelegationActivitiesNow(map: Map<string, DelegationActivity[]>): void {
  persistDelegationActivities(map)
}

/** 用户设置：是否显示子 Agent（协作委派）执行 UI（默认 true；关闭后仍可执行但不展示） */
export const showDelegationUiAtom = atom<boolean>(true)

/** 清空某工具（或全部）的流式输出缓存 */
export function clearToolStreamOutput(
  map: Map<string, string>,
  toolUseId?: string,
): Map<string, string> {
  if (!toolUseId) return new Map()
  const next = new Map(map)
  next.delete(toolUseId)
  return next
}
