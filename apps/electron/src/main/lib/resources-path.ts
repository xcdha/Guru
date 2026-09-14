/**
 * resources-path — 解析打包 / 开发两种形态下的内置资源目录
 *
 * 从 src/main/ipc.ts 提升为独立模块（2026-09-14）：它被 ipc.ts 的
 * resolveAppIconPath 与「附件管理相关」IPC 分组共用，放在 ipc.ts 内会导致
 * 任一方都无法独立成模块。
 */
import { app } from 'electron'
import { join } from 'node:path'

/**
 * 注册 IPC 处理器
 *
 * 注册的通道：
 * - runtime:get-status: 获取运行时状态
 * - git:get-repo-status: 获取指定目录的 Git 仓库状态
 * - channel:*: 渠道管理相关
 * - chat:*: 对话管理 + 消息发送 + 流式事件
 */
/**
 * 打包内置资源目录
 * dev: __dirname/resources（build:resources 阶段拷贝）
 * prod: process.resourcesPath（electron-builder extraResources 产物）
 */
export function getBundledResourcesDir(): string {
  return app.isPackaged ? process.resourcesPath : join(__dirname, 'resources')
}
