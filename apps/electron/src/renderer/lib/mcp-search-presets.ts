import type { McpServerEntry } from '@guru/shared'

/**
 * 官方搜索 MCP 连接器模板。
 *
 * 对齐上游 Proma #1976 / #2040（Brave/Tavily/Exa MCP presets）：用户只需填入 API Key，
 * 其余连接参数由模板预填。Brave 走 stdio npx + 环境变量注入；
 * Tavily 走官方远程 MCP + Authorization 请求头；Exa 走 x-api-key 请求头。
 */
export type SearchMcpPresetId = 'brave-search' | 'exa-search' | 'tavily-search'

export interface McpPresetTemplate {
  id: SearchMcpPresetId
  name: string
  /** 连接器显示名（作为服务器名建议值，用户可改） */
  serverName: string
  displayName: string
  description: string
  buildEntry: (apiKey: string) => McpServerEntry
}

const BRAVE_SEARCH_PRESET: McpPresetTemplate = {
  id: 'brave-search',
  name: 'Brave Search',
  serverName: 'brave-search',
  displayName: 'Brave 搜索 MCP',
  description: 'Brave 官方搜索 MCP（stdio），提供网页、新闻、图片与视频搜索。',
  buildEntry: (apiKey) => {
    const env: Record<string, string> = {}
    // 预填 key 名空值：表单文本区显示 BRAVE_API_KEY=，用户直接补 value 即可
    env.BRAVE_API_KEY = apiKey
    return {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@brave/brave-search-mcp-server', '--transport', 'stdio'],
      env,
      enabled: true,
    }
  },
}

const TAVILY_SEARCH_PRESET: McpPresetTemplate = {
  id: 'tavily-search',
  name: 'Tavily Search',
  serverName: 'tavily-search',
  displayName: 'Tavily 搜索 MCP',
  description: 'Tavily 官方远程 MCP，为 Agent 提供面向 AI 的网页搜索、提取与研究能力。',
  buildEntry: (apiKey) => {
    const headers: Record<string, string> = {}
    // 预填 header 名：表单文本区显示 Authorization: Bearer，用户补 key 即可
    headers.Authorization = apiKey ? `Bearer ${apiKey}` : 'Bearer '
    return {
      type: 'http',
      url: 'https://mcp.tavily.com/mcp',
      headers,
      enabled: true,
    }
  },
}

const EXA_SEARCH_PRESET: McpPresetTemplate = {
  id: 'exa-search',
  name: 'Exa Search',
  serverName: 'exa',
  displayName: 'Exa 搜索 MCP',
  description: '接入 Exa 官方远程 MCP，提供语义网页搜索与页面内容提取能力。',
  buildEntry: (apiKey) => {
    const headers: Record<string, string> = {}
    // 预填 header 名：表单文本区显示 x-api-key:，用户补 key 即可
    headers['x-api-key'] = apiKey
    return {
      type: 'http',
      url: 'https://mcp.exa.ai/mcp',
      headers,
      enabled: true,
    }
  },
}

export const SEARCH_MCP_PRESETS: readonly McpPresetTemplate[] = [
  BRAVE_SEARCH_PRESET,
  EXA_SEARCH_PRESET,
  TAVILY_SEARCH_PRESET,
]

export function getSearchMcpPreset(id: SearchMcpPresetId): McpPresetTemplate | undefined {
  return SEARCH_MCP_PRESETS.find((preset) => preset.id === id)
}
