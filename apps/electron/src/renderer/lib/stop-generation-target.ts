/**
 * 停止生成目标解析（移植自 Proma c6dfb3f5）
 *
 * 停止快捷键（Cmd+Shift+Backspace）只应中断用户当前聚焦的会话，
 * 而不是广播给所有挂载的 AgentView/ChatView（多会话/父+委派子会话
 * 同时挂载时会导致停止错会话）。
 *
 * 机制：视图获得焦点/点击时记住目标；快捷键触发时携带目标事件，
 * 各视图校验目标是否是自己才执行停止。
 */

export type StopGenerationTarget =
  | { kind: 'agent'; sessionId: string }
  | { kind: 'chat'; sessionId: string }

interface SessionTabLike {
  type: string
  sessionId: string
}

let lastInteractedStopTarget: StopGenerationTarget | null = null

/** Records the Agent or Chat view that most recently received focus or a click. */
export function rememberStopGenerationTarget(target: StopGenerationTarget): void {
  lastInteractedStopTarget = target
}

/** Returns the Agent or Chat view where the user's input cursor or last click is. */
export function getLastInteractedStopTarget(): StopGenerationTarget | null {
  return lastInteractedStopTarget
}

/** Clears the stored target only when the owning view unmounts. */
export function clearStopGenerationTarget(target: StopGenerationTarget): void {
  if (
    lastInteractedStopTarget?.kind === target.kind
    && lastInteractedStopTarget.sessionId === target.sessionId
  ) {
    lastInteractedStopTarget = null
  }
}

/**
 * Resolves a fallback target when the user has not yet focused or clicked a
 * conversation view in this window.
 */
export function resolveStopGenerationTarget(
  activeTab: SessionTabLike | null,
  activeAgentSidePanelTab: string | undefined,
): StopGenerationTarget | null {
  if (!activeTab) return null

  if (activeTab.type === 'agent') {
    const delegatedChildSessionId = activeAgentSidePanelTab?.startsWith('delegation:')
      ? activeAgentSidePanelTab.slice('delegation:'.length)
      : null

    return {
      kind: 'agent',
      sessionId: delegatedChildSessionId || activeTab.sessionId,
    }
  }

  if (activeTab.type === 'chat') {
    return { kind: 'chat', sessionId: activeTab.sessionId }
  }

  return null
}

/** Reads and validates a target attached to the global stop shortcut event. */
export function getStopGenerationTarget(event: Event): StopGenerationTarget | null {
  const detail = (event as CustomEvent<unknown>).detail
  if (!detail || typeof detail !== 'object') return null

  const candidate = detail as Partial<StopGenerationTarget>
  if (
    (candidate.kind !== 'agent' && candidate.kind !== 'chat')
    || typeof candidate.sessionId !== 'string'
    || candidate.sessionId.length === 0
  ) {
    return null
  }

  return candidate as StopGenerationTarget
}
