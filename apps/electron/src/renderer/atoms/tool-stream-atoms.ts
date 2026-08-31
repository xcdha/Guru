import { atom } from 'jotai'

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
  phase: 'tool_start' | 'tool_result' | 'assistant'
  toolName?: string
  brief?: string
  isError?: boolean
  text?: string
}

/** 每个委派的最新活动列表（保留最近 30 条） */
export const delegationActivityAtom = atom<Map<string, DelegationActivity[]>>(new Map())

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
