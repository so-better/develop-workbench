/**
 * 主进程与渲染进程共用的纯函数工具。
 * 这里不要引入 Electron、Node 文件系统或浏览器 DOM 专属能力。
 */

/** IPC 错误前缀，用于把 Electron 包装后的错误还原成业务提示。 */
const IPC_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/

/** 判断是否为普通对象，排除 null、数组和其他原始值。 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 统一处理字符串字段：只保留字符串、去首尾空格，并限制长度。 */
export const normalizeText = (value: unknown, maxLength: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''

/** 提取无协议地址中的主机名，用于判断默认协议。 */
const getHostname = (value: string): string => {
  const host = value.split('/')[0] ?? ''

  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end > 0 ? host.slice(1, end) : host
  }

  return host.split(':')[0] ?? ''
}

/** IP、localhost 和 .local 主机默认使用 http，其余默认 https。 */
const getDefaultProtocol = (value: string): 'http' | 'https' => {
  const hostname = getHostname(value).toLowerCase()
  const isIpv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)
  const isIpv6 = hostname.includes(':') && /^[0-9a-f:]+$/i.test(hostname)

  return isIpv4 || isIpv6 || hostname === 'localhost' || hostname.endsWith('.local')
    ? 'http'
    : 'https'
}

/**
 * 规范化 HTTP/HTTPS 地址。
 * 缺少协议时，IP / localhost 自动补 http，其余自动补 https。
 */
export const normalizeHttpUrl = (value: unknown, label = 'URL'): string => {
  if (typeof value !== 'string') throw new Error(`${label}不合法`)

  let normalized = value.trim()

  if (!normalized) throw new Error(`${label}不能为空`)

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) {
    normalized = `${getDefaultProtocol(normalized)}://${normalized}`
  }

  let url: URL

  try {
    url = new URL(normalized)
  } catch {
    throw new Error(`${label}格式不正确`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label}只支持 http/https 地址`)
  }

  return url.toString()
}

/** 规范化地址，失败时返回 null，用于浏览器导航等不应抛错的场景。 */
export const tryNormalizeHttpUrl = (value: string): string | null => {
  try {
    return normalizeHttpUrl(value)
  } catch {
    return null
  }
}

/** RFC 3986 中无需编码即可出现在 URL 中的字符。 */
const URL_CHARACTER = /[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]/

/**
 * 自动识别或粘贴的地址后面常紧跟中文正文、破折号等非 URL 字符。
 * 截断到第一个非法字符，并去掉句末标点，避免把正文当成地址。
 */
export const trimUrlTrailingText = (value: string): string => {
  const text = value.trim()
  let end = 0

  while (end < text.length && URL_CHARACTER.test(text[end])) end += 1

  return text.slice(0, end).replace(/[.,;:!?]+$/, '')
}

/**
 * 把异常转换成适合界面展示的简短文本。
 * 同时剥掉 Electron IPC 的包装前缀，并折叠多余空白。
 */
export const getErrorMessage = (
  error: unknown,
  fallback = '未知错误'
): string => {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : fallback

  const message = raw
    .replace(IPC_ERROR_PREFIX, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 280)

  return message || fallback
}

/** 等待指定毫秒数，供轮询和重试流程复用。 */
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** 去掉常见 Markdown 标记，生成待办提醒和 aria-label 使用的短摘要。 */
export const getQuickNoteSummary = (text: string, maxLength = 120): string => {
  const summary = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return summary.slice(0, maxLength) || '待办'
}
