/**
 * 飞书云文档和消息搜索。
 * 使用 lark-cli Drive / IM 搜索接口，返回快速访问需要的最小字段。
 */
import { ipcMain } from 'electron'
import { runLarkCli } from './lark'
import type { LarkDocSearchResult, LarkMessageSearchResult } from '../types/lark'

interface LarkSearchResponse {
  ok?: boolean
  error?: {
    message?: string
  }
  data?: {
    results?: Array<{
      entity_type?: string
      result_meta?: {
        url?: string
        doc_types?: string
        owner_name?: string
        update_time_iso?: string
      }
      title_highlighted?: string
      summary_highlighted?: string
    }>
  }
}

/** 去掉搜索高亮标签和常见 HTML 实体。 */
const stripHighlight = (value?: string): string =>
  (value ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()

/** 压缩消息正文，避免卡片和长文本占满搜索结果。 */
const compactMessage = (value?: string): string =>
  stripHighlight(value).replace(/\s+/g, ' ').slice(0, 180)

/** 将飞书 applink 转成桌面客户端协议。 */
const toFeishuAppUrl = (value?: string): string | null => {
  const raw = value?.trim()

  if (!raw) return null

  try {
    const url = new URL(raw)

    if (url.protocol !== 'https:' || url.hostname !== 'applink.feishu.cn') {
      return null
    }

    // 客户端协议需要保留 applink.feishu.cn 作为 host，才能完整处理 position 等参数。
    return `lark://applink.feishu.cn${url.pathname}${url.search}`
  } catch {
    return null
  }
}

/** 飞书搜索 query 最多 30 个 Unicode 字符。 */
const normalizeQuery = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('搜索关键词不合法')

  return Array.from(value.trim()).slice(0, 30).join('')
}

/** 搜索飞书云文档。 */
export const searchLarkDocs = async (
  query: unknown
): Promise<LarkDocSearchResult[]> => {
  const keyword = normalizeQuery(query)

  if (!keyword) return []

  const output = await runLarkCli([
    'drive',
    '+search',
    '--query',
    keyword,
    '--page-size',
    '10',
    '--format',
    'json'
  ])
  let parsed: LarkSearchResponse

  try {
    parsed = JSON.parse(output) as LarkSearchResponse
  } catch {
    throw new Error('飞书文档搜索返回格式不正确')
  }

  if (parsed.ok === false) {
    throw new Error(parsed.error?.message || '飞书文档搜索失败')
  }

  return (parsed.data?.results ?? [])
    .map((result) => {
      const meta = result.result_meta
      const url = meta?.url?.trim()

      if (!url) return null

      const title = stripHighlight(result.title_highlighted)
      const summary = stripHighlight(result.summary_highlighted)

      return {
        id: url,
        title: title || url,
        url,
        type: meta?.doc_types || result.entity_type || '飞书文档',
        owner: meta?.owner_name?.trim() || null,
        updatedAt: meta?.update_time_iso?.trim() || null,
        summary: summary || null
      }
    })
    .filter((result): result is LarkDocSearchResult => Boolean(result))
}

interface LarkMessageSearchResponse {
  ok?: boolean
  error?: {
    message?: string
  }
  data?: {
    messages?: Array<{
      message_id?: string
      chat_name?: string
      chat_type?: string
      content?: string
      create_time?: string
      message_app_link?: string
      sender?: {
        name?: string
      }
    }>
  }
}

/** 搜索飞书消息。 */
export const searchLarkMessages = async (
  query: unknown
): Promise<LarkMessageSearchResult[]> => {
  const keyword = normalizeQuery(query)

  if (!keyword) return []

  const output = await runLarkCli([
    'im',
    '+messages-search',
    '--query',
    keyword,
    '--page-size',
    '10',
    '--no-reactions',
    '--format',
    'json'
  ])
  let parsed: LarkMessageSearchResponse

  try {
    parsed = JSON.parse(output) as LarkMessageSearchResponse
  } catch {
    throw new Error('飞书消息搜索返回格式不正确')
  }

  if (parsed.ok === false) {
    throw new Error(parsed.error?.message || '飞书消息搜索失败')
  }

  return (parsed.data?.messages ?? [])
    .map((message) => {
      const url = message.message_app_link?.trim()

      if (!url) return null

      return {
        id: message.message_id?.trim() || url,
        chatName:
          message.chat_name?.trim() ||
          (message.chat_type === 'p2p' ? '私聊' : '飞书消息'),
        senderName: message.sender?.name?.trim() || '未知发送人',
        content: compactMessage(message.content),
        createdAt: message.create_time?.trim() || null,
        url,
        appUrl: toFeishuAppUrl(url)
      }
    })
    .filter((message): message is LarkMessageSearchResult => Boolean(message))
}

/** 注册飞书文档和消息搜索 IPC。 */
export const initializeLarkSearch = (): void => {
  ipcMain.handle('lark:search-docs', (_event, query: unknown) =>
    searchLarkDocs(query)
  )
  ipcMain.handle('lark:search-messages', (_event, query: unknown) =>
    searchLarkMessages(query)
  )
}
