import type { McpServerDefinition } from './types'

/**
 * 已接入的 MCP 服务列表。
 * 新增服务只需在这里追加配置；只有需要特殊鉴权时才使用 getHeaders。
 */
export const MCP_SERVERS: McpServerDefinition[] = [
  {
    id: 'anysearch',
    name: 'AnySearch',
    url: 'https://api.anysearch.com/mcp'
    // AnySearch 支持匿名访问；需要更高配额时再通过 headers/getHeaders 补充鉴权。
  }
]
