/**
 * 链接预览模块。
 * 飞书链接通过 lark-cli 解析，其他链接读取页面 Open Graph 信息。
 */
import { ipcMain } from 'electron'
import { lookup as lookupDns } from 'node:dns/promises'
import type { LookupAddress, LookupOptions } from 'node:dns'
import { isIP } from 'node:net'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { runLarkCli } from './lark'
import type { LinkPreview } from '../types/link-preview'

interface CacheEntry {
  expiresAt: number
  preview: LinkPreview
}

interface InspectResponse {
  ok?: boolean
  data?: {
    title?: string
    type?: string
    wiki_node?: unknown
  }
}

const CACHE_TTL_MS = 30 * 60 * 1000
const FETCH_TIMEOUT_MS = 5_000
const MAX_HTML_BYTES = 512 * 1024
const MAX_REDIRECTS = 3
const MAX_CONCURRENT_REQUESTS = 4
const MAX_CACHE_ENTRIES = 200
const cache = new Map<string, CacheEntry>()
const pending = new Map<string, Promise<LinkPreview>>()
let activeRequests = 0
const requestWaiters: Array<() => void> = []

const FEISHU_TYPE_LABELS: Record<string, string> = {
  doc: '飞书文档',
  docx: '飞书文档',
  sheet: '飞书表格',
  bitable: '多维表格',
  slides: '飞书幻灯片',
  wiki: '飞书知识库',
  file: '飞书文件',
  mindnote: '飞书思维笔记'
}

/**
 * 判断是否飞书域名。
 */
const isFeishuHost = (hostname: string): boolean =>
  hostname === 'feishu.cn' ||
  hostname.endsWith('.feishu.cn') ||
  hostname === 'larksuite.com' ||
  hostname.endsWith('.larksuite.com')

/**
 * 判断 IPv4 是否属于内网或保留地址。
 */
const isPrivateIPv4 = (address: string): boolean => {
  const parts = address.split('.').map(Number)

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true

  const [first, second, third] = parts

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (third === 0 || third === 2)) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  )
}

/**
 * 判断 IPv6 是否属于内网或保留地址。
 */
const isPrivateIPv6 = (address: string): boolean => {
  const value = address.toLowerCase()

  if (value === '::' || value === '::1') return true
  if (value.startsWith('fc') || value.startsWith('fd')) return true
  if (/^fe[89ab]/.test(value)) return true
  if (value.startsWith('::ffff:')) return isPrivateIPv4(value.slice(7))

  return false
}

const isPrivateAddress = (address: string): boolean =>
  address.includes(':') ? isPrivateIPv6(address) : isPrivateIPv4(address)

const publicLookup = (
  hostname: string,
  options: LookupOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number
  ) => void
): void => {
  lookupDns(hostname, {
    family: options.family,
    all: true
  })
    .then((addresses) => {
      if (addresses.length === 0) {
        callback(new Error('域名解析失败'), '', 0)
        return
      }

      if (addresses.some(({ address }) => isPrivateAddress(address))) {
        callback(new Error('不允许访问内网地址'), '', 0)
        return
      }

      if (options.all) {
        callback(null, addresses, addresses[0].family)
        return
      }

      callback(null, addresses[0].address, addresses[0].family)
    })
    .catch((error: NodeJS.ErrnoException) => {
      callback(error, '', 0)
    })
}

/**
 * 禁止访问本机和内网地址，避免 SSRF。
 */
const assertPublicUrl = async (url: URL): Promise<void> => {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只允许 http/https 链接')
  }

  if (url.username || url.password) throw new Error('链接不能包含认证信息')
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new Error('不允许访问该端口')
  }

  const hostname = url.hostname.toLowerCase()

  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new Error('不允许访问内网地址')
  }

  if (isIP(hostname)) {
    const isPrivate = hostname.includes(':')
      ? isPrivateIPv6(hostname)
      : isPrivateIPv4(hostname)

    if (isPrivate) throw new Error('不允许访问内网地址')
  }
}

/**
 * 读取响应正文并限制大小。
 */
const readLimitedBody = async (response: IncomingMessage): Promise<string> => {
  const decoder = new TextDecoder()
  let total = 0
  let content = ''

  try {
    for await (const chunk of response) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
      const remaining = MAX_HTML_BYTES - total

      if (buffer.byteLength >= remaining) {
        if (remaining > 0) {
          content += decoder.decode(buffer.subarray(0, remaining), { stream: true })
        }

        response.destroy()
        break
      }

      total += buffer.byteLength
      content += decoder.decode(buffer, { stream: true })
    }
  } catch (error) {
    response.destroy()
    throw error
  }

  return content + decoder.decode()
}

/**
 * 请求页面 HTML，并逐跳校验重定向目标。
 */
const fetchPageHtml = async (url: URL, redirectCount = 0): Promise<string> => {
  await assertPublicUrl(url)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('页面请求超时')), FETCH_TIMEOUT_MS)

  try {
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        url,
        {
          method: 'GET',
          signal: controller.signal,
          lookup: publicLookup,
          headers: {
            'user-agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36',
            accept: 'text/html,application/xhtml+xml',
            'accept-encoding': 'identity'
          }
        },
        resolve
      )

      request.once('error', reject)
      request.end()
    })
    const status = response.statusCode ?? 0

    if ([301, 302, 303, 307, 308].includes(status)) {
      const location = response.headers.location
      response.destroy()

      if (typeof location !== 'string' || redirectCount >= MAX_REDIRECTS) {
        throw new Error('链接重定向过多')
      }

      return fetchPageHtml(new URL(location, url), redirectCount + 1)
    }

    if (status < 200 || status >= 300) {
      response.destroy()
      throw new Error(`页面请求失败：${status}`)
    }

    const rawContentType = response.headers['content-type']
    const contentType = Array.isArray(rawContentType)
      ? rawContentType.join(',')
      : rawContentType ?? ''

    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      response.destroy()
      throw new Error('链接不是 HTML 页面')
    }

    return readLimitedBody(response)
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * 解码常见 HTML 实体。
 */
const decodeEntities = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()

/**
 * 提取 title 和 Open Graph 信息。
 */
const parseHtmlPreview = (
  html: string,
  url: URL
): { title: string | null; description: string | null; siteName: string | null } => {
  const meta = new Map<string, string>()

  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /(?:property|name)=["']([^"']+)["']/i.exec(tag)?.[1]
    const content = /content=["']([^"']*)["']/i.exec(tag)?.[1]

    if (key && content) meta.set(key.toLowerCase(), decodeEntities(content))
  }

  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]

  return {
    title: meta.get('og:title') || (titleTag ? decodeEntities(titleTag) : null),
    description: meta.get('og:description') || meta.get('description') || null,
    siteName: meta.get('og:site_name') || url.hostname
  }
}

/**
 * 通过 lark-cli 解析飞书文档标题。
 */
const inspectFeishuLink = async (url: URL): Promise<LinkPreview> => {
  const fallback: LinkPreview = {
    url: url.toString(),
    title: null,
    description: null,
    siteName: url.hostname,
    type: '飞书文档',
    host: url.hostname,
    isFeishu: true
  }

  try {
    const output = await runLarkCli(['drive', '+inspect', '--url', url.toString(), '--format', 'json'])
    const response = JSON.parse(output) as InspectResponse

    if (!response.ok || !response.data) return fallback

    const type = response.data.wiki_node
      ? '飞书知识库'
      : FEISHU_TYPE_LABELS[response.data.type ?? ''] ?? '飞书文档'

    return {
      ...fallback,
      title: response.data.title?.trim() || null,
      type
    }
  } catch {
    return fallback
  }
}

const acquireRequestSlot = (): Promise<void> =>
  new Promise((resolve) => {
    if (activeRequests < MAX_CONCURRENT_REQUESTS) {
      activeRequests += 1
      resolve()
      return
    }

    requestWaiters.push(() => {
      activeRequests += 1
      resolve()
    })
  })

const releaseRequestSlot = (): void => {
  activeRequests = Math.max(0, activeRequests - 1)
  requestWaiters.shift()?.()
}

const withRequestSlot = async <T>(task: () => Promise<T>): Promise<T> => {
  await acquireRequestSlot()

  try {
    return await task()
  } finally {
    releaseRequestSlot()
  }
}

const setCachedPreview = (key: string, preview: LinkPreview): void => {
  const now = Date.now()

  for (const [cacheKey, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(cacheKey)
  }

  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value

    if (oldestKey === undefined) break

    cache.delete(oldestKey)
  }

  cache.set(key, {
    expiresAt: now + CACHE_TTL_MS,
    preview
  })
}

/**
 * 获取链接预览。
 */
export const getLinkPreview = async (rawUrl: string): Promise<LinkPreview> => {
  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('链接格式不合法')
  }

  const key = url.toString()
  const cached = cache.get(key)

  if (cached && cached.expiresAt > Date.now()) return cached.preview

  const pendingRequest = pending.get(key)

  if (pendingRequest) return pendingRequest

  const request = withRequestSlot(async () => {
    let preview: LinkPreview

    if (isFeishuHost(url.hostname)) {
      preview = await inspectFeishuLink(url)
    } else {
      try {
        const html = await fetchPageHtml(url)
        const parsed = parseHtmlPreview(html, url)

        preview = {
          url: key,
          title: parsed.title,
          description: parsed.description,
          siteName: parsed.siteName,
          type: '网页',
          host: url.hostname,
          isFeishu: false
        }
      } catch {
        preview = {
          url: key,
          title: null,
          description: null,
          siteName: url.hostname,
          type: '网页',
          host: url.hostname,
          isFeishu: false
        }
      }
    }

    setCachedPreview(key, preview)

    return preview
  }).finally(() => {
    pending.delete(key)
  })

  pending.set(key, request)

  return request
}

/**
 * 注册链接预览 IPC。
 */
export const initializeLinkPreview = (): void => {
  ipcMain.handle('link-preview:get', (_event, url: unknown) => {
    if (typeof url !== 'string') throw new Error('链接格式不合法')
    return getLinkPreview(url)
  })
}
