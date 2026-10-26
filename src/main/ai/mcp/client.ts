import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CompatibilityCallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { McpServerDefinition } from './types'

/** 建连、工具发现和工具调用的兜底超时，避免 MCP 服务无响应时一直挂起。 */
const CONNECT_TIMEOUT = 15_000
const LIST_TOOLS_TIMEOUT = 20_000
const CALL_TOOL_TIMEOUT = 60_000

/** 按服务 ID 缓存客户端，避免每次聊天都重新建立 MCP 连接。 */
const clients = new Map<string, { promise: Promise<Client> | null }>()

/** 创建并初始化单个 MCP 客户端，连接阶段同样受超时保护。 */
const createClient = async (server: McpServerDefinition): Promise<Client> => {
  // 静态 headers 与动态 headers 合并，动态值优先级更高。
  const headers = {
    ...server.headers,
    ...server.getHeaders?.()
  }
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers }
  })
  const client = new Client(
    { name: 'develop-workbench', version: '0.1.0' },
    { capabilities: {} }
  )

  await client.connect(transport, { timeout: CONNECT_TIMEOUT })
  return client
}

/** 懒加载客户端；连接失败时清空缓存，下一次调用可以重新尝试。 */
const getClient = (server: McpServerDefinition): Promise<Client> => {
  let entry = clients.get(server.id)

  if (!entry) {
    entry = { promise: null }
    clients.set(server.id, entry)
  }

  if (!entry.promise) {
    entry.promise = createClient(server).catch((error) => {
      entry!.promise = null
      throw error
    })
  }

  return entry.promise
}

/** 丢弃指定服务的连接缓存，用于工具调用异常后的重连。 */
export const resetServer = (serverId: string): void => {
  clients.delete(serverId)
}

/** 拉取指定服务当前暴露的全部工具定义，最多遍历 10 页。 */
export const listServerTools = async (server: McpServerDefinition) => {
  const client = await getClient(server)
  const tools: Awaited<ReturnType<typeof client.listTools>>['tools'] = []
  let cursor: string | undefined

  for (let page = 0; page < 10; page += 1) {
    const result = await client.listTools(
      cursor ? { cursor } : undefined,
      { timeout: LIST_TOOLS_TIMEOUT }
    )

    tools.push(...result.tools)
    cursor = result.nextCursor

    if (!cursor) break
  }

  return { tools }
}

/**
 * 调用 MCP 工具。
 * 只有只读工具在连接异常时会丢弃连接并重试一次，避免写操作重复执行。
 */
export const callServerTool = async (
  server: McpServerDefinition,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  retryOnFailure = false
): Promise<CompatibilityCallToolResult> => {
  const call = async (): Promise<CompatibilityCallToolResult> => {
    const client = await getClient(server)

    return client.callTool(
      { name: toolName, arguments: args },
      undefined,
      { timeout: CALL_TOOL_TIMEOUT, signal }
    )
  }

  try {
    return await call()
  } catch (error) {
    if (signal?.aborted || !retryOnFailure) throw error

    resetServer(server.id)
    return call()
  }
}
