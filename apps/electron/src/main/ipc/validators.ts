/**
 * validators — IPC 处理器共用的轻量类型守卫
 *
 * 从 `src/main/ipc.ts` 中的 registerIpcHandlers 内联声明提升而来（2026-09-14）。
 * 原因：这些守卫声明在「定时任务（Automation）」分组块的顶部，但 `isNonEmptyString`
 * 也被「用户授权的 Markdown Vault」等分组使用；直接把 Automation 分组抽成模块会
 * 让块外代码失去该声明。提升为独立模块后，各分组可各自 import，互不影响。
 *
 * 语义与原内联实现完全一致（renderer 进程可能被注入不可信内容，主进程必须自行
 * 校验，拒绝 NaN / -Infinity / 越界值等）。
 */

export const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0
