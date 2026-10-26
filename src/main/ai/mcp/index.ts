import type { CompatibilityCallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { jsonSchema, tool } from 'ai'
import type { JSONSchema7, ToolSet } from 'ai'
import type { AiChatSource } from '../../../types/ai'
import { isRecord } from '../../../utils'
import { callServerTool, listServerTools } from './client'
import { MCP_SERVERS } from './config'
import { getToolLabel } from './labels'
import type { McpToolTarget } from './types'

/** 工具结果最大文本长度，避免 MCP 返回的大段内容撑爆上下文。 */
const MAX_TOOL_TEXT = 24_000
/** 模型工具名长度上限，给服务前缀和去重后缀留出空间。 */
const MAX_TOOL_NAME_LENGTH = 64
/** 单个 MCP 最多注册的工具数。 */
const MAX_TOOLS_PER_SERVER = 50
/** 全部 MCP 最多注册的工具数。 */
const MAX_TOOLS_TOTAL = 100
/** 单个工具描述最大长度，避免工具说明本身占用过多上下文。 */
const MAX_TOOL_DESCRIPTION = 4_000

/** 注册名 -> 原始服务与工具名，供来源解析和后续调用使用。 */
const toolTargets = new Map<string, McpToolTarget>()
/** 并发请求共享同一次工具发现，避免重复连接同一个 MCP。 */
let toolsPromise: Promise<ToolSet> | null = null

type ServerToolDefinitions = Awaited<
  ReturnType<typeof listServerTools>
>['tools']

interface ServerToolsCache {
  definitions: ServerToolDefinitions
  expiresAt: number
}

/** 工具定义缓存。连接失败时不会写入空结果，下一次对话会自动重试。 */
const TOOLS_CACHE_TTL_MS = 5 * 60 * 1000
const serverToolsCache = new Map<string, ServerToolsCache>()

/**
 * 读取单个服务的工具定义。
 * 缓存过期后重新发现；本次失败时优先复用旧定义，避免短暂抖动导致工具消失。
 */
const loadServerTools = async (
  server: (typeof MCP_SERVERS)[number]
): Promise<ServerToolDefinitions> => {
  const cached = serverToolsCache.get(server.id)
  const now = Date.now()

  if (cached && cached.expiresAt > now) return cached.definitions

  try {
    const { tools } = await listServerTools(server)
    const limited = tools.slice(0, MAX_TOOLS_PER_SERVER)

    if (limited.length) {
      serverToolsCache.set(server.id, {
        definitions: limited,
        expiresAt: now + TOOLS_CACHE_TTL_MS
      })
    }

    return limited
  } catch {
    return cached?.definitions ?? []
  }
}

/** 把 MCP 的 content / structuredContent / 旧版 toolResult 统一转成文本。 */
const getResultText = (result: CompatibilityCallToolResult): string => {
  if ('content' in result && Array.isArray(result.content)) {
    const text = result.content
      .filter(
        (item): item is { type: 'text'; text: string } => item.type === 'text'
      )
      .map((item) => item.text)
      .join('\n\n')

    if (text) return text
  }

  if (isRecord(result.structuredContent)) {
    return JSON.stringify(result.structuredContent)
  }

  if ('toolResult' in result) {
    return typeof result.toolResult === 'string'
      ? result.toolResult
      : JSON.stringify(result.toolResult)
  }

  return ''
}

/**
 * 归一化 MCP 工具结果。
 * 错误结果直接抛出；结构化结果保留对象；普通结果截断后交给模型。
 */
const getToolResult = (
  result: CompatibilityCallToolResult
): Record<string, unknown> | string => {
  if ('isError' in result && result.isError) {
    throw new Error(getResultText(result) || 'MCP 工具执行失败')
  }

  if (isRecord(result.structuredContent)) {
    const content =
      typeof result.structuredContent.content === 'string'
        ? result.structuredContent.content.slice(0, MAX_TOOL_TEXT)
        : undefined
    const structured = {
      ...result.structuredContent,
      ...(content ? { content } : {})
    }
    const serialized = JSON.stringify(structured)

    return serialized.length > MAX_TOOL_TEXT
      ? serialized.slice(0, MAX_TOOL_TEXT)
      : structured
  }

  return getResultText(result).slice(0, MAX_TOOL_TEXT)
}

/** 模型传入的参数在运行时可能不是对象，这里做一次防御性收敛。 */
const toInputArgs = (input: unknown): Record<string, unknown> =>
  isRecord(input) ? input : {}

/** 清理非法字符，保证注册名符合模型对工具名的限制。 */
const sanitizeName = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_-]/g, '_')

/**
 * 为工具生成 `{serverId}_{toolName}` 形式的注册名。
 * 同名时追加序号，保证多个 MCP 服务可以同时接入。
 */
const buildToolName = (
  serverId: string,
  toolName: string,
  used: Set<string>
): string => {
  const base = `${sanitizeName(serverId)}_${sanitizeName(toolName)}`.slice(
    0,
    MAX_TOOL_NAME_LENGTH
  )
  let name = base
  let index = 2

  while (used.has(name)) {
    const suffix = `_${index}`
    name = `${base.slice(0, MAX_TOOL_NAME_LENGTH - suffix.length)}${suffix}`
    index += 1
  }

  used.add(name)
  return name
}

/**
 * 连接 config.ts 中配置的所有 MCP 服务，发现并注册工具。
 * 单个服务连接失败只跳过该服务，不影响本地工具和其他 MCP。
 */
export const getMcpTools = async (): Promise<ToolSet> => {
  if (toolsPromise) return toolsPromise

  const promise = (async () => {
    const tools: ToolSet = {}
    const usedNames = new Set<string>()

    toolTargets.clear()

    for (const server of MCP_SERVERS) {
      if (usedNames.size >= MAX_TOOLS_TOTAL) break

      const definitions = await loadServerTools(server)

      for (const definition of definitions) {
        if (usedNames.size >= MAX_TOOLS_TOTAL) break
        const registeredName = buildToolName(
          server.id,
          definition.name,
          usedNames
        )

        toolTargets.set(registeredName, {
          server,
          toolName: definition.name
        })

        const readOnly =
          isRecord(definition.annotations) &&
          definition.annotations.readOnlyHint === true

        const description = definition.description?.trim() || definition.name

        tools[registeredName] = tool({
          description: `[${server.name}] ${
            description.length > MAX_TOOL_DESCRIPTION
              ? `${description.slice(0, MAX_TOOL_DESCRIPTION)}…`
              : description
          }`,
          metadata: {
            label: `${server.name} · ${getToolLabel(definition)}`
          },
          inputSchema: jsonSchema(definition.inputSchema as JSONSchema7),
          execute: async (input, options) =>
            getToolResult(
              await callServerTool(
                server,
                definition.name,
                toInputArgs(input),
                options?.abortSignal,
                readOnly
              )
            )
        })
      }
    }

    return tools
  })()

  toolsPromise = promise

  try {
    return await promise
  } finally {
    if (toolsPromise === promise) toolsPromise = null
  }
}

/** 读取工具输出中的文本；来源解析只依赖文本和结构化 url/title。 */
const getOutputText = (output: unknown): string => {
  if (typeof output === 'string') return output
  if (isRecord(output) && typeof output.text === 'string') return output.text

  return ''
}

/** 从搜索结果 Markdown 或结构化网页结果中提取引用来源。 */
const parseSources = (output: unknown): AiChatSource[] => {
  const sources: AiChatSource[] = []
  const seen = new Set<string>()
  const text = getOutputText(output)

  if (text) {
    const pattern =
      /###\s+\d+\.\s+([^\n]+)\n-\s+\*\*URL\*\*:\s*(https?:\/\/[^\s)]+)/g

    for (const match of text.matchAll(pattern)) {
      const title = match[1]?.trim()
      const url = match[2]?.trim()

      if (!url || seen.has(url)) continue

      seen.add(url)
      sources.push({ id: url, title: title || url, url })
    }
  }

  if (isRecord(output)) {
    const url = typeof output.url === 'string' ? output.url.trim() : ''
    const title =
      typeof output.title === 'string' && output.title.trim()
        ? output.title.trim()
        : url

    if (url && !seen.has(url)) {
      sources.push({ id: url, title, url })
    }
  }

  return sources
}

/** 根据工具注册名从对应 MCP 结果中提取参考来源。 */
export const getMcpSources = (
  registeredName: string,
  output: unknown
): AiChatSource[] => {
  if (!toolTargets.has(registeredName)) return []

  return parseSources(output)
}
