/**
 * Agent 文件路径辅助 — 主进程侧
 *
 * 展开 Agent 报告路径中的 shell 风格 `~` 缩写；相对路径语义与授权校验
 * 仍由各自调用方（file-preview-service / agent-file-path-policy）完成。
 */

import { homedir } from 'node:os'
import { resolve } from 'node:path'

/**
 * 展开 shell 风格的用户目录缩写。
 *
 * Node 的 path API 不会处理 `~`；只识别当前用户的 `~`、`~/…` 与 `~\\…`，
 * 不支持也不会猜测 `~other-user`。后续调用方仍须完成自身的授权校验。
 */
export function expandHomeDirectory(filePath: string): string {
  if (filePath === '~') return homedir()
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return resolve(homedir(), ...filePath.slice(2).split(/[\\/]+/))
  }
  return filePath
}
