/**
 * 飞书云文档和消息搜索。
 * 使用 lark-cli Drive / IM 搜索接口，返回快速访问需要的最小字段。
 */
import { ipcMain } from 'electron'
import { runLarkCli } from './lark'
import type {
  LarkChatSearchResult,
  LarkDocSearchResult,
  LarkMessageSearchResult
} from '../types/lark'

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

/** 提取卡片标题。 */
const extractCardTitle = (value?: string): string => {
  const match = value?.match(/<card\s+title="([^"]+)"/i)

  return stripHighlight(match?.[1])
}

/** 压缩消息正文，折叠图片和链接，避免卡片内容占满搜索结果。 */
const compactMessage = (value?: string): string => {
  const cleaned = (value ?? '')
    .replace(/<card[^>]*>/gi, '')
    .replace(/<\/card>/gi, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gi, '$1')
    .replace(/https?:\/\/[^\s)]+/gi, (url) => {
      try {
        return `[${new URL(url).hostname}]`
      } catch {
        return '[链接]'
      }
    })
    .replace(/\[Media:[^\]]+\]/gi, '[附件]')
    .replace(/\[图片\]/g, '图片')
    .split(/\*\*发件人：\*\*|\[分享至会话\]/)[0]
    .replace(/<[^>]+>/g, ' ')
    .replace(/(?:图片\s*){2,}/g, '图片 ')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned.slice(0, 180)
}

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
        title:
          extractCardTitle(message.content) ||
          compactMessage(message.content) ||
          message.chat_name?.trim() ||
          '飞书消息',
        content: compactMessage(message.content),
        createdAt: message.create_time?.trim() || null,
        url,
        appUrl: toFeishuAppUrl(url)
      }
    })
    .filter((message): message is LarkMessageSearchResult => Boolean(message))
}

interface LarkChatSearchResponse {
  ok?: boolean
  error?: {
    message?: string
  }
  data?: {
    chats?: Array<{
      chat_id?: string
      name?: string
      description?: string
      external?: boolean
    }>
  }
}

/** 搜索飞书群聊名称。 */
export const searchLarkChats = async (
  query: unknown
): Promise<LarkChatSearchResult[]> => {
  const keyword = normalizeQuery(query)

  if (!keyword) return []

  const output = await runLarkCli([
    'im',
    '+chat-search',
    '--query',
    keyword,
    '--page-size',
    '10',
    '--disable-search-by-user',
    '--format',
    'json'
  ])
  let parsed: LarkChatSearchResponse

  try {
    parsed = JSON.parse(output) as LarkChatSearchResponse
  } catch {
    throw new Error('飞书群聊搜索返回格式不正确')
  }

  if (parsed.ok === false) {
    throw new Error(parsed.error?.message || '飞书群聊搜索失败')
  }

  return (parsed.data?.chats ?? [])
    .map((chat) => {
      const chatId = chat.chat_id?.trim()

      if (!chatId) return null

      const url = `https://applink.feishu.cn/client/chat/open?openChatId=${encodeURIComponent(
        chatId
      )}`

      return {
        id: chatId,
        name: chat.name?.trim() || '未命名群聊',
        description: chat.description?.trim() || null,
        external: Boolean(chat.external),
        url,
        appUrl: toFeishuAppUrl(url)
      }
    })
    .filter((chat): chat is LarkChatSearchResult => Boolean(chat))
}

/** 注册飞书文档、消息和群聊搜索 IPC。 */
export const initializeLarkSearch = (): void => {
  ipcMain.handle('lark:search-docs', (_event, query: unknown) =>
    searchLarkDocs(query)
  )
  ipcMain.handle('lark:search-messages', (_event, query: unknown) =>
    searchLarkMessages(query)
  )
  ipcMain.handle('lark:search-chats', (_event, query: unknown) =>
    searchLarkChats(query)
  )
}
