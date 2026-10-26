/**
 * 单个 MCP 服务配置。
 * 新增 MCP 时只需要在 config.ts 追加配置，不需要单独目录。
 */
export interface McpServerDefinition {
  /** 稳定服务 ID，同时作为工具名前缀，避免多个服务工具重名。 */
  id: string
  /** 界面上展示的服务名称。 */
  name: string
  /** MCP Streamable HTTP 地址。 */
  url: string
  /** 固定请求头，例如某些服务需要的版本或租户标识。 */
  headers?: Record<string, string>
  /** 动态请求头，适合从环境变量读取密钥，避免写入源码。 */
  getHeaders?: () => Record<string, string>
}

/**
 * 注册名到原始 MCP 工具的映射。
 * 调用工具和解析来源时需要使用服务端原始工具名。
 */
export interface McpToolTarget {
  server: McpServerDefinition
  toolName: string
}
