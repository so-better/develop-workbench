/**
 * Markdown 图片代理。
 * 飞书图片接口依赖内嵌浏览器的登录 Cookie，不能由渲染进程直接加载。
 */
import { ipcMain, session } from 'electron'
import { BROWSER_PARTITION } from './embedded-browser'

const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_CACHE_BYTES = 64 * 1024 * 1024
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 40
const IMAGE_TIMEOUT_MS = 20_000

const ALLOWED_IMAGE_HOSTS = [
  'feishu.cn',
  'larksuite.com',
  'feishucdn.com',
  'larksuitecdn.com'
]

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36'

interface CachedImage {
  dataUrl: string
  expiresAt: number
}

const imageCache = new Map<string, CachedImage>()
let cacheBytes = 0

/**
 * 飞书下载接口有时返回 application/octet-stream，需要根据文件头判断图片类型。
 */
const detectImageMime = (buffer: Buffer): string | null => {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png'
  }

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'image/jpeg'
  }

  if (buffer.subarray(0, 6).toString('ascii').startsWith('GIF8')) {
    return 'image/gif'
  }

  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }

  if (buffer.subarray(0, 2).toString('ascii') === 'BM') {
    return 'image/bmp'
  }

  return null
}

const isAllowedImageUrl = (url: URL): boolean =>
  url.protocol === 'https:' &&
  ALLOWED_IMAGE_HOSTS.some(
    (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
  )

const getCachedImage = (url: string): string | null => {
  const cached = imageCache.get(url)

  if (!cached) return null

  if (cached.expiresAt <= Date.now()) {
    imageCache.delete(url)
    cacheBytes -= cached.dataUrl.length
    return null
  }

  // 重新插入以维持近似 LRU 顺序。
  imageCache.delete(url)
  imageCache.set(url, cached)

  return cached.dataUrl
}

const cacheImage = (url: string, dataUrl: string): void => {
  const existing = imageCache.get(url)

  if (existing) {
    imageCache.delete(url)
    cacheBytes -= existing.dataUrl.length
  }

  imageCache.set(url, {
    dataUrl,
    expiresAt: Date.now() + CACHE_TTL_MS
  })
  cacheBytes += dataUrl.length

  while (
    imageCache.size > MAX_CACHE_ENTRIES ||
    cacheBytes > MAX_CACHE_BYTES
  ) {
    const oldestKey = imageCache.keys().next().value as string | undefined

    if (!oldestKey) break

    const oldest = imageCache.get(oldestKey)
    imageCache.delete(oldestKey)

    if (oldest) cacheBytes -= oldest.dataUrl.length
  }
}

/**
 * 使用 workbench 浏览器的持久化 Session 拉取飞书图片。
 * 返回 data URL，避免把受保护的图片地址直接暴露给渲染进程网络栈。
 */
const loadImage = async (rawUrl: string): Promise<string | null> => {
  const cached = getCachedImage(rawUrl)

  if (cached) return cached

  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  if (!isAllowedImageUrl(url)) return null

  try {
    const browserSession = session.fromPartition(BROWSER_PARTITION)
    const response = await browserSession.fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      credentials: 'include',
      headers: {
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        referer: `${url.origin}/`,
        'user-agent': USER_AGENT
      },
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS)
    })

    if (!response.ok) return null

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    const contentLength = Number(response.headers.get('content-length') ?? 0)

    if (contentLength > MAX_IMAGE_BYTES) return null

    const buffer = Buffer.from(await response.arrayBuffer())

    if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
      return null
    }

    const declaredType = contentType.split(';')[0]
    const mime = declaredType.startsWith('image/')
      ? declaredType
      : detectImageMime(buffer)

    if (!mime) return null

    const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`

    cacheImage(rawUrl, dataUrl)

    return dataUrl
  } catch {
    return null
  }
}

/**
 * 注册 Markdown 图片代理 IPC。
 */
export const initializeMarkdownImages = (): void => {
  ipcMain.handle('markdown:get-image', (_event, rawUrl: unknown) => {
    if (typeof rawUrl !== 'string') return null

    return loadImage(rawUrl)
  })
}
