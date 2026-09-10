import type { WorkspaceMcpConfig } from '../types/agent'

/**
 * 从配置中移除单个 MCP 条目，不改动其他服务器的配置与启用状态。
 */
export function removeMcpServerFromConfig(
  config: WorkspaceMcpConfig,
  name: string,
): WorkspaceMcpConfig {
  const servers = { ...config.servers }
  delete servers[name]
  return { servers }
}
