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

/**
 * 规范化 HTTP/HTTPS 地址。
 * 缺少协议时自动补 https，并校验最终协议。
 */
export const normalizeHttpUrl = (value: unknown, label = 'URL'): string => {
  if (typeof value !== 'string') throw new Error(`${label}不合法`)

  let normalized = value.trim()

  if (!normalized) throw new Error(`${label}不能为空`)

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`
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
